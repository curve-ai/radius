import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { OperationalError, RuntimeUnavailableError } from "./errors.js";
import { fetchRuntime, runtimeHostIsAvailable } from "./runtime-assets.js";

/**
 * Finding and launching the installed Radius desktop app.
 *
 * Both halves of this file exist because the CLI used to assume a repo
 * checkout. A developer installs the app; they do not clone the product to
 * use it. The packaged app already carries the runtime host and the guest
 * kernel under `Contents/Resources/runtime/`, so the only thing missing was
 * the CLI looking there.
 */

export interface RuntimeAssets {
  readonly runtimeHostPath: string;
  readonly kernelPath: string;
  /** Where these came from, so the CLI can say so rather than being opaque. */
  readonly source: string;
}

/** Walk-up roots, so a project inside the repo finds the repo. */
function repoCandidates(projectRoot: string): string[] {
  return [projectRoot, join(projectRoot, ".."), join(projectRoot, "..", "..")];
}

/** Where an installed app lives: the bundles `radius app` installs and updates. */
export function installedAppCandidates(env: NodeJS.ProcessEnv): string[] {
  const explicit = env.RADIUS_APP_PATH?.trim();
  return [
    ...(explicit ? [explicit] : []),
    "/Applications/Radius.app",
    join(homedir(), "Applications", "Radius.app"),
  ];
}

/**
 * Someone working on Radius who has run `package` has a real bundle in the
 * checkout, and would expect `dev` to open that one rather than be told
 * nothing is installed. Never installed over or updated: it is a build
 * output, and its version says nothing about what is released.
 */
function repoBundleCandidates(projectRoot: string): string[] {
  return repoCandidates(projectRoot).flatMap((root) => [
    join(root, "apps", "desktop", "dist", "mac-arm64", "Radius.app"),
    join(root, "apps", "desktop", "dist", "mac", "Radius.app"),
  ]);
}

function appBundleCandidates(
  env: NodeJS.ProcessEnv,
  projectRoot?: string,
): string[] {
  return [
    ...installedAppCandidates(env),
    ...(projectRoot ? repoBundleCandidates(projectRoot) : []),
  ];
}

/** The repo root, if this project sits inside a Radius checkout. */
async function findRepoRoot(projectRoot: string): Promise<string | null> {
  for (const root of repoCandidates(projectRoot)) {
    try {
      await access(join(root, "apps", "desktop", "package.json"));
      return root;
    } catch {
      // Not a checkout; try the next level up.
    }
  }
  return null;
}

/**
 * In order of how much the caller meant it: an explicit override, then the
 * installed app, then a repo checkout for people working on Radius itself.
 */
export async function resolveRuntimeAssets(input: {
  readonly projectRoot: string;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: string;
  readonly arch?: string;
  readonly onProgress?: (message: string) => void;
}): Promise<RuntimeAssets> {
  const overriddenHost = input.env.RADIUS_RUNTIME_HOST_PATH?.trim();
  const overriddenKernel = input.env.RADIUS_KERNEL_PATH?.trim();
  if (overriddenHost && overriddenKernel) {
    return {
      runtimeHostPath: overriddenHost,
      kernelPath: overriddenKernel,
      source: "RADIUS_RUNTIME_HOST_PATH / RADIUS_KERNEL_PATH",
    };
  }

  if (input.platform === "win32") return resolveWindowsRuntimeAssets(input);

  const tried: string[] = [];

  for (const bundle of appBundleCandidates(input.env, input.projectRoot)) {
    const runtime = join(bundle, "Contents", "Resources", "runtime");
    const host = join(runtime, `macos-${process.arch}`, "radius-runtime-host");
    const kernel = join(runtime, "vmlinux-arm64");
    tried.push(bundle);
    if (await bothExist(host, kernel)) {
      return {
        runtimeHostPath: overriddenHost ?? host,
        kernelPath: overriddenKernel ?? kernel,
        source: bundle,
      };
    }
  }

  // Working on Radius itself: the assets sit in the checkout, not an app.
  for (const candidate of [
    input.projectRoot,
    join(input.projectRoot, ".."),
    join(input.projectRoot, "..", ".."),
  ]) {
    const base = join(candidate, "apps", "runtime-host-macos", ".build");
    const host = join(base, "release", "radius-runtime-host");
    tried.push(base);
    for (const kernel of [
      join(base, "runtime-assets", "vmlinux-arm64"),
      join(base, "vmlinux-arm64"),
    ]) {
      if (await bothExist(host, kernel)) {
        return {
          runtimeHostPath: overriddenHost ?? host,
          kernelPath: overriddenKernel ?? kernel,
          source: `${base} (repo checkout)`,
        };
      }
    }
  }

  // Last resort, and the one that works on a machine with no Radius on it at
  // all: fetch the runtime the CLI pins for itself. Tried last rather than
  // first because a locally installed app is the runtime the agent will
  // actually run under, so verifying against that one is more honest than
  // verifying against a version only the CLI knows about.
  if (runtimeHostIsAvailable(input.env)) {
    return fetchRuntime(input.onProgress ?? (() => {}), input.env);
  }

  throw new RuntimeUnavailableError(
    "Could not find the Radius runtime, which is what boots the microVM a build is verified in.",
    [
      "No published runtime is available for this CLI version yet, so it has to come from somewhere on this machine:",
      "  · the Radius desktop app, which ships it",
      "  · a repo checkout, after `bun run runtime:build` and `bun run runtime:prepare-assets`",
      "",
      "Or pass --skip-verify to produce the image without booting it.",
      "",
      "Looked in:",
      ...tried.map((path) => `  ${path}`),
      "",
      "Override with RADIUS_APP_PATH, or RADIUS_RUNTIME_HOST_PATH and RADIUS_KERNEL_PATH together.",
    ].join("\n"),
  );
}

async function resolveWindowsRuntimeAssets(input: {
  readonly projectRoot: string;
  readonly env: NodeJS.ProcessEnv;
  readonly arch?: string;
}): Promise<RuntimeAssets> {
  if ((input.arch ?? process.arch) !== "x64") {
    throw new RuntimeUnavailableError(
      "The Windows runtime requires an x64 computer.",
    );
  }
  const env = input.env;
  const bundles = [
    ...(env.RADIUS_APP_PATH?.trim() ? [env.RADIUS_APP_PATH.trim()] : []),
    ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, "Programs", "Radius")] : []),
    ...(env.ProgramFiles ? [join(env.ProgramFiles, "Radius")] : []),
    ...repoCandidates(input.projectRoot).map((root) =>
      join(root, "apps", "desktop", "dist", "win-unpacked"),
    ),
  ];
  const candidates = [
    ...bundles.map((bundle) => ({
      host: join(
        bundle,
        "resources",
        "runtime",
        "windows-x64",
        "radius-runtime-host.exe",
      ),
      kernel: join(bundle, "resources", "runtime", "vmlinux-x64"),
      source: bundle,
    })),
    ...repoCandidates(input.projectRoot).map((root) => {
      const base = join(root, "apps", "runtime-host-windows", ".build");
      return {
        host: join(base, "release", "radius-runtime-host.exe"),
        kernel: join(base, "runtime-assets", "vmlinux-x64"),
        source: `${base} (repo checkout)`,
      };
    }),
  ];
  for (const candidate of candidates) {
    const host = env.RADIUS_RUNTIME_HOST_PATH?.trim() ?? candidate.host;
    const kernel = env.RADIUS_KERNEL_PATH?.trim() ?? candidate.kernel;
    if (await bothExist(host, kernel)) {
      try {
        await access(join(host, "..", "openvmm.exe"));
        return {
          runtimeHostPath: host,
          kernelPath: kernel,
          source: candidate.source,
        };
      } catch {
        /* Try the next complete runtime. */
      }
    }
  }
  throw new RuntimeUnavailableError(
    "Could not find the Windows Radius runtime and its x64 kernel.",
    "Install Radius, build the Windows runtime in a checkout, or set RADIUS_RUNTIME_HOST_PATH and RADIUS_KERNEL_PATH. Use --skip-verify to produce an image without booting it.",
  );
}

async function bothExist(host: string, kernel: string): Promise<boolean> {
  try {
    await Promise.all([access(host, constants.X_OK), access(kernel)]);
    return true;
  } catch {
    return false;
  }
}

export interface FoundApp {
  readonly path: string;
  /** False for a repo build output, which is opened but never updated. */
  readonly installed: boolean;
}

/**
 * In order of how much the caller meant it: RADIUS_APP_PATH, then
 * /Applications, then ~/Applications, then a bundle in a Radius checkout.
 */
export async function findDesktopApp(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly projectRoot?: string;
}): Promise<FoundApp | null> {
  for (const path of installedAppCandidates(input.env)) {
    if (await exists(path)) return { path, installed: true };
  }
  for (const path of input.projectRoot
    ? repoBundleCandidates(input.projectRoot)
    : []) {
    if (await exists(path)) return { path, installed: false };
  }
  return null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The pattern the app accepts; a link with any other id is ignored. */
const AGENT_ID = /^agent_[A-Za-z0-9_-]{6,64}$/;

export function devAgentLink(agentId: string): string {
  if (!AGENT_ID.test(agentId)) {
    throw new OperationalError(
      `${agentId} is not an agent id Radius can open.`,
      "Agent ids look like agent_ followed by 6 to 64 letters, digits, - or _. Run `radius init` to assign one.",
    );
  }
  return `radius://dev-agent/${agentId}`;
}

/** Runs a command to completion; true when it exits 0. Injected by tests. */
export type Spawner = (
  command: string,
  args: readonly string[],
) => Promise<boolean>;

export const spawnDetached: Spawner = (command, args) =>
  new Promise((settle) => {
    const child = spawn(command, [...args], {
      stdio: "ignore",
      detached: true,
    });
    child.once("error", () => settle(false));
    child.once("exit", (code) => settle(code === 0));
    child.unref();
  });

export interface LaunchResult {
  readonly launched: boolean;
  readonly detail: string;
  /** The bundle opened, when one was. */
  readonly path?: string;
}

/**
 * Brings the desktop app up, on the agent when one is named.
 *
 * The link is passed with `open -a` rather than opened on its own, so it
 * reaches this bundle whether or not macOS has registered the scheme, and
 * the app handles it the same way on a cold start as when it is already
 * running.
 *
 * Failure is reported, not thrown: the agent is registered before this runs,
 * and a dev session that already works must not die because an app could not
 * be opened.
 */
export async function launchDesktopApp(input: {
  readonly platform: string;
  readonly env: NodeJS.ProcessEnv;
  readonly projectRoot: string;
  readonly agentId?: string;
  /** Skips the lookup when the caller already knows the bundle. */
  readonly bundle?: string;
  readonly spawner?: Spawner;
}): Promise<LaunchResult> {
  if (input.platform !== "darwin") {
    return {
      launched: false,
      detail: "Opening Radius automatically is macOS-only for now.",
    };
  }
  // Validated before anything is spawned, so a bad id is an error rather
  // than an app that opens and silently shows nothing.
  const link = input.agentId ? devAgentLink(input.agentId) : null;

  const bundle =
    input.bundle ??
    (await findDesktopApp({ env: input.env, projectRoot: input.projectRoot }))
      ?.path;
  if (bundle) {
    const opened = await (input.spawner ?? spawnDetached)("open", [
      "-a",
      bundle,
      ...(link ? [link] : []),
    ]);
    return opened
      ? { launched: true, detail: bundle, path: bundle }
      : {
          launched: false,
          detail: `Found ${bundle} but could not open it. Open Radius yourself.`,
        };
  }

  // No bundle. If this is a Radius checkout the app exists as source, and the
  // useful answer is the command that starts it — not "not installed", which
  // is false and unactionable for the one person most likely to see it.
  // Deliberately not run for them: `electron-vite dev` is a long-lived build
  // process that would outlive this command or have to be supervised by it.
  const repo = await findRepoRoot(input.projectRoot);
  if (repo) {
    return {
      launched: false,
      detail: [
        "Radius is not installed as an app.",
        `Running from source: \`bun run dev\` in ${repo}.`,
        "For a bundle this command can open: `bun run --cwd apps/desktop package`.",
      ].join(" "),
    };
  }
  return {
    launched: false,
    detail:
      "Radius does not appear to be installed. The agent is registered — run `radius app install`, or open Radius and it will show up.",
  };
}
