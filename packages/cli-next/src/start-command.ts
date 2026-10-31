import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { AgentConfig } from "@curve-ai/agent-contracts";

import { UsageError } from "./errors.js";
import { resolveHarness } from "./harness.js";
import { readLanggraphGraphs } from "./project-agents.js";

/**
 * How `dev` starts one copy of the agent on this machine.
 *
 * Every runtime kind ends in the same place — an argv whose process speaks
 * ACP over stdio — so the bridge and the preflight never branch on kind.
 * Only this function does.
 */
export interface StartCommand {
  readonly kind: AgentConfig["runtime"]["kind"];
  readonly command: readonly string[];
  /** One short phrase for the ready line, e.g. `python -m pkg.agent`. */
  readonly summary: string;
  /** Harness only: where the bytes came from and whether they were cached. */
  readonly harness?: { readonly source: string; readonly cached: boolean };
  /**
   * Variables the config sets for the process, laid over the caller's own
   * environment. Carried here rather than read by each caller, so the
   * preflight, the bridge and `check` cannot start different processes.
   */
  readonly env: Readonly<Record<string, string>>;
}

export interface StartHost {
  readonly platform: string;
  readonly arch: string;
  readonly env: NodeJS.ProcessEnv;
}

export async function resolveStartCommand(
  config: AgentConfig,
  cwd: string,
  host: StartHost,
  onProgress: (message: string) => void,
): Promise<StartCommand> {
  const runtime = config.runtime;
  switch (runtime.kind) {
    case "harness": {
      const resolved = await resolveHarness(config, cwd, host, onProgress);
      // A binary harness resolves to an absolute path that was just
      // extracted; only the npx/uvx runners can be missing.
      const runner = resolved.command[0] as string;
      if (!isAbsolute(runner))
        await requireOnPath(runner, host, runnerHint(runner));
      return {
        kind: "harness",
        command: resolved.command,
        summary: `harness ${runtime.registryId ?? resolved.source}`,
        harness: { source: resolved.source, cached: resolved.cached },
        env: runtime.env ?? {},
      };
    }
    case "python": {
      await requireOnPath(
        "uv",
        host,
        "Python agents run through uv, which reads the project's lockfile. Install it from https://docs.astral.sh/uv/ and try again.",
      );
      return {
        kind: "python",
        // --python pins the interpreter the build ships, so a thread in `dev`
        // does not quietly run on whatever python3 the shell found first.
        command: [
          "uv",
          "run",
          "--python",
          runtime.python,
          "python",
          "-m",
          runtime.module,
        ],
        summary: `python -m ${runtime.module}`,
        env: {},
      };
    }
    case "langgraph": {
      const configPath = resolve(cwd, runtime.config);
      const graphs = await readLanggraphGraphs(configPath);
      if (graphs === null) {
        throw new UsageError(
          `runtime.config ${runtime.config} does not exist in ${cwd}. A langgraph runtime serves the graphs that file lists.`,
        );
      }
      const names = runtime.graph ? [runtime.graph] : Object.keys(graphs);
      const adapterArgs = [
        "--config",
        runtime.config,
        ...(runtime.graph ? ["--graph", runtime.graph] : []),
      ];
      const summary = `langgraph ${names.length > 0 ? names.join(", ") : runtime.config}`;
      if (runtime.language === "typescript") {
        return {
          kind: "langgraph",
          command: [...(await typescriptAdapter(cwd, host)), ...adapterArgs],
          summary,
          env: {},
        };
      }
      await requireOnPath(
        "uv",
        host,
        "LangGraph agents run through uv, which installs the Radius adapter next to the project's own dependencies. Install it from https://docs.astral.sh/uv/ and try again.",
      );
      return {
        kind: "langgraph",
        // `--with` layers the adapter over the project's environment rather
        // than asking the project to depend on it: the project stays a plain
        // LangGraph project, and Radius chooses the adapter version.
        command: [
          "uv",
          "run",
          "--python",
          runtime.python,
          "--with",
          resolveAdapter(
            host.env.RADIUS_LANGGRAPH_ADAPTER || runtime.adapter,
            cwd,
          ),
          "radius-langgraph",
          ...adapterArgs,
        ],
        summary,
        env: {},
      };
    }
    case "typescript": {
      const entrypoint = resolve(cwd, runtime.entrypoint);
      if (!(await exists(entrypoint))) {
        throw new UsageError(
          `runtime.entrypoint ${runtime.entrypoint} does not exist in ${cwd}.`,
        );
      }
      const node = await requireOnPath(
        "node",
        host,
        `TypeScript agents run on Node ${runtime.node}. Install it and make sure \`node\` is on PATH.`,
      );
      // No `tsx watch`: each desktop thread gets a fresh process, so an edit
      // is picked up by the next thread without a watcher restarting one
      // that is mid-conversation.
      const command = needsTypeScriptLoader(entrypoint)
        ? [node, "--import", resolveTsxLoader(cwd), entrypoint]
        : [node, entrypoint];
      return {
        kind: "typescript",
        command,
        summary: `typescript ${runtime.entrypoint}`,
        env: {},
      };
    }
    case "command": {
      const [executable] = runtime.command;
      await requireOnPath(
        executable as string,
        host,
        `runtime.command starts with \`${executable}\`, which was not found.`,
        cwd,
      );
      return {
        kind: "command",
        command: runtime.command,
        // The executable only: the full argv is --verbose detail, and an inline
        // script would swamp the ready line.
        summary: `command ${basename(executable as string)}`,
        env: {},
      };
    }
  }
}

/** The environment a started process sees: the caller's, then the config's. */
export function startEnvironment(
  start: Pick<StartCommand, "env">,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return { ...env, ...start.env };
}

/**
 * The `--with` value for the Python LangGraph adapter, and the checkout the
 * TypeScript one runs from.
 *
 * `RADIUS_LANGGRAPH_ADAPTER`, read from the CLI's own environment, overrides
 * `runtime.adapter`. It exists because `radius-langgraph` is not on PyPI
 * yet, and the TypeScript adapter not on npm, so neither pinned default can
 * install; pointing it at a checkout of `packages/langgraph-acp-python` or
 * `packages/langgraph-acp-typescript` lets `dev` and `check` run against the
 * adapter as it is in this repository. It is read here, before the child
 * starts, because the child never sees `RADIUS_*` variables.
 *
 * A path is made absolute because uv resolves `--with` against its own cwd,
 * and `~` is expanded because no shell sits between spawn and uv to do it.
 */
export function resolveAdapter(adapter: string, cwd: string): string {
  if (adapter === "~" || adapter.startsWith("~/"))
    return join(homedir(), adapter.slice(1));
  if (adapter.startsWith(".") || adapter.startsWith("/"))
    return resolve(cwd, adapter);
  return adapter;
}

/**
 * The npm package that serves JavaScript and TypeScript graphs. Pinned here
 * rather than in `radius.json`, because the project never chooses it: like
 * the Python adapter it is layered over the project, which keeps its own
 * `@langchain/langgraph`. Not on npm yet, so the default cannot install;
 * `RADIUS_LANGGRAPH_ADAPTER` points at a checkout until it is published.
 */
export const LANGGRAPH_TYPESCRIPT_ADAPTER = "@curve-ai/radius-langgraph@0.0.1";

/**
 * How to start the TypeScript adapter. `RADIUS_LANGGRAPH_ADAPTER` names a
 * checkout of `packages/langgraph-acp-typescript`, run with `node` directly
 * so a change to it shows up in the next `dev` or `check`; otherwise npx
 * fetches the pinned package. Both need Node, which the graphs run on too.
 */
async function typescriptAdapter(
  cwd: string,
  host: StartHost,
): Promise<string[]> {
  const node = await requireOnPath(
    "node",
    host,
    "TypeScript LangGraph agents run on Node. Install it and make sure `node` is on PATH.",
  );
  const override = host.env.RADIUS_LANGGRAPH_ADAPTER;
  if (override) {
    // Always a directory here, never a requirement, so a bare name is
    // a path relative to the project too.
    const bin = join(
      resolve(cwd, resolveAdapter(override, cwd)),
      "bin",
      "radius-langgraph.mjs",
    );
    if (!(await exists(bin))) {
      throw new UsageError(
        `RADIUS_LANGGRAPH_ADAPTER is ${override}, but ${bin} does not exist. Point it at a checkout of packages/langgraph-acp-typescript.`,
      );
    }
    return [node, bin];
  }
  await requireOnPath(
    "npx",
    host,
    "TypeScript LangGraph agents fetch the Radius adapter with npx, which ships with Node. Install Node and try again.",
  );
  return ["npx", "--yes", LANGGRAPH_TYPESCRIPT_ADAPTER];
}

function runnerHint(runner: string): string {
  return runner === "uvx"
    ? "This harness is distributed through uvx. Install uv from https://docs.astral.sh/uv/ and try again."
    : `This harness is distributed through ${runner}. Install Node.js and try again.`;
}

function needsTypeScriptLoader(entrypoint: string): boolean {
  return /\.(?:[cm]?ts|tsx)$/i.test(entrypoint);
}

/**
 * The project's own tsx first, so an agent pinned to a tsx version runs on
 * it; the CLI's copy otherwise, so a project with no tsx still starts.
 * Passed as a file URL because `--import tsx` would resolve from the child's
 * cwd and fail exactly when the fallback is needed.
 */
function resolveTsxLoader(cwd: string): string {
  try {
    return pathToFileURL(createRequire(join(cwd, "noop.js")).resolve("tsx"))
      .href;
  } catch {
    return import.meta.resolve("tsx");
  }
}

/**
 * Finds `name` the way the spawned process would, and fails with a usage
 * error naming what to install. Without this a missing `uv` surfaced as a
 * bare `spawn uv ENOENT` from the preflight.
 */
async function requireOnPath(
  name: string,
  host: StartHost,
  hint: string,
  cwd?: string,
): Promise<string> {
  const found = await findExecutable(name, host, cwd);
  if (!found)
    throw new UsageError(`\`${name}\` was not found on PATH. ${hint}`);
  return found;
}

export async function findExecutable(
  name: string,
  host: Pick<StartHost, "platform" | "env">,
  cwd?: string,
): Promise<string | null> {
  const windows = host.platform === "win32";
  const extensions = windows
    ? ["", ...(host.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")]
    : [""];
  const candidates = (base: string): string[] =>
    extensions.map((extension) => `${base}${extension}`);

  // A path, not a name: spawn resolves it against the child's cwd.
  if (/[\\/]/.test(name)) {
    for (const candidate of candidates(resolve(cwd ?? ".", name))) {
      if (await isExecutable(candidate, windows)) return candidate;
    }
    return null;
  }
  const path = host.env.PATH ?? host.env.Path ?? "";
  for (const directory of path.split(windows ? ";" : ":")) {
    if (!directory) continue;
    for (const candidate of candidates(join(directory, name))) {
      if (await isExecutable(candidate, windows)) return candidate;
    }
  }
  return null;
}

async function isExecutable(path: string, windows: boolean): Promise<boolean> {
  try {
    // A directory passes X_OK too, and spawning one fails with EACCES.
    if (!(await stat(path)).isFile()) return false;
    await access(path, windows ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
