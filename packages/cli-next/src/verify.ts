import { spawn } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse as parsePath } from "node:path";

import type { AgentConfig } from "@curve-ai/agent-contracts";
import {
  MicrovmAcpRuntime,
  parseAgentReleaseDescriptor,
  type SessionConfigOption,
} from "@curve-ai/radius-runtime";

import { OperationalError, UsageError } from "./errors.js";
import type { RadiusContext } from "./context.js";

/**
 * Boots the built image in a microVM and checks it speaks ACP.
 *
 * Carried across from the old CLI's `sandbox.ts` rather than imported — the
 * two defects it had are requirements here, not patches there:
 *
 *  1. It hardcoded `rootfsMb: 2048`, so it verified a guest sized differently
 *     from the one the layout ships. The size now comes from the release
 *     template embedded in the image being verified.
 *  2. It chose `process.arguments` from the runtime kind with no harness
 *     branch, so a harness image would have been booted as `node agent.mjs`.
 *     The arguments now come from the same template, which the builder has
 *     already filled in from the harness's own command.
 */

export interface VerifiableBuild {
  readonly buildDigest: string;
  readonly imageReference: string;
  readonly imageDigest: string;
  readonly layoutPath: string;
}

export interface VerifyOptions {
  readonly root: string;
  readonly config: AgentConfig;
  readonly build: VerifiableBuild;
  readonly context: RadiusContext;
  readonly runtimeHostPath?: string;
  readonly kernelPath?: string;
  readonly runtimeRoot?: string;
}

export interface VerifyResult {
  readonly protocolVersion: number;
  readonly loadedDigest: string;
  /**
   * What the agent advertised once a session existed.
   *
   * For a harness this is the evidence that matters. A harness image that
   * lost the project tree still starts and still answers `initialize` — it
   * just serves the harness's own default agents. The agents named here come
   * from the shipped tree, so they distinguish the two outcomes without
   * needing a provider credential.
   */
  readonly advertisedAgents: readonly string[];
  readonly authMethods: readonly string[];
}

export async function verifyBuild(
  options: VerifyOptions,
): Promise<VerifyResult> {
  const { context } = options;
  if (context.process.platform !== "darwin" || context.process.arch !== "arm64") {
    throw new UsageError(
      "Verifying a build boots a microVM, which currently requires Apple Silicon macOS. Producing the layout does not — rerun with --skip-verify.",
    );
  }

  const defaults = await resolveDefaultRuntimeAssets(options.root);
  const runtimeHostPath =
    options.runtimeHostPath ??
    context.env.RADIUS_RUNTIME_HOST_PATH ??
    defaults.runtimeHostPath;
  const kernelPath =
    options.kernelPath ?? context.env.RADIUS_KERNEL_PATH ?? defaults.kernelPath;
  const runtimeRoot =
    options.runtimeRoot ??
    context.env.RADIUS_RUNTIME_ROOT ??
    join(options.root, ".radius", "build", "runtime");

  await Promise.all([
    requirePath(runtimeHostPath, "runtime helper"),
    requirePath(kernelPath, "runtime kernel"),
    mkdir(runtimeRoot, { recursive: true }),
  ]);

  const loadedDigest = await loadImage({
    runtimeHostPath,
    layoutPath: options.build.layoutPath,
    runtimeRoot,
    imageReference: options.build.imageReference,
  });
  context.out(`  loaded       ${loadedDigest}`);

  // The descriptor the image carries is the one the desktop will import, so
  // verification runs against that rather than against a second, hand-built
  // one that could disagree with it.
  const shipped = await readShippedTemplate(options.build.layoutPath);
  const release = parseAgentReleaseDescriptor({
    ...shipped,
    // Identity is scoped to this verification run; the shipped agent id
    // belongs to the import, not to a throwaway boot.
    agentId: `build-${options.build.buildDigest.slice(0, 16)}`,
    providerId: "radius-cli-build",
    image: { ...(shipped.image as object), digest: loadedDigest },
  });

  context.out("  booting      microVM");
  const runtime = await MicrovmAcpRuntime.start({
    release,
    paths: { runtimeHostPath, kernelPath, runtimeRoot },
    cwd: (release.process as { statePath?: string }).statePath ?? "/opt/data",
    handlers: {
      onPermissionRequest: async () => ({ outcome: "cancelled" }),
    },
    onStderr: (chunk: string) => context.note(chunk.trimEnd()),
  });

  try {
    // Stops after `session/new` deliberately. A prompt needs a provider
    // credential, and `build` must never require one — so this proves the
    // agent starts, speaks the protocol and offers the right agents, not
    // that it answers correctly. The asymmetry against the native path is
    // intentional and reported rather than hidden.
    const session = runtime.session;
    return {
      protocolVersion: session.protocolVersion,
      loadedDigest,
      advertisedAgents: advertisedAgents(session),
      authMethods: session.authMethods.map((method) => method.id),
    };
  } finally {
    await runtime.stop();
  }
}

/**
 * Reads the release template the builder embedded in the image config.
 *
 * Parsing the layout rather than recomputing the descriptor is the whole
 * point: if the two ever disagree, the one that ships is the one that matters.
 */
async function readShippedTemplate(
  layoutPath: string,
): Promise<Record<string, unknown>> {
  const index = JSON.parse(
    await readFile(join(layoutPath, "index.json"), "utf8"),
  ) as { manifests: Array<{ digest: string }> };
  const manifest = JSON.parse(
    await readBlob(layoutPath, index.manifests[0]!.digest),
  ) as { config: { digest: string } };
  const imageConfig = JSON.parse(
    await readBlob(layoutPath, manifest.config.digest),
  ) as { config?: { Labels?: Record<string, string> } };
  const labels = imageConfig.config?.Labels ?? {};
  const encoded = labels["ai.curve.radius.release-template.v1"];
  if (!encoded) {
    throw new OperationalError(
      "The built image carries no release template, so there is nothing to verify against.",
      "This is a builder bug — the template is embedded as an OCI config label.",
    );
  }
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as Record<
    string,
    unknown
  >;
}

async function readBlob(layoutPath: string, digest: string): Promise<string> {
  const [algorithm, hex] = digest.split(":");
  return readFile(join(layoutPath, "blobs", algorithm!, hex!), "utf8");
}

async function loadImage(input: {
  runtimeHostPath: string;
  layoutPath: string;
  runtimeRoot: string;
  imageReference: string;
}): Promise<string> {
  const stdout = await run(input.runtimeHostPath, [
    "load-image",
    "--layout",
    input.layoutPath,
    "--root",
    input.runtimeRoot,
  ]);
  const report = JSON.parse(stdout) as {
    type?: string;
    protocolVersion?: number;
    images?: Array<{ reference?: string; digest?: string }>;
  };
  if (
    report.type !== "radius.runtime.images-loaded" ||
    report.protocolVersion !== 1 ||
    !Array.isArray(report.images)
  ) {
    throw new OperationalError(
      "The runtime host returned an image-load report this CLI does not understand.",
      `Reported: ${stdout.trim().slice(0, 400)}`,
    );
  }
  // The layout can hold more than one tag, so the reference is matched rather
  // than assuming a single entry.
  const loaded = report.images.find(
    (candidate) => candidate.reference === input.imageReference,
  );
  if (!loaded?.digest) {
    const found = report.images
      .map((candidate) => candidate.reference ?? "(unnamed)")
      .join(", ");
    throw new OperationalError(
      `The runtime host loaded the layout but not ${input.imageReference}.`,
      `It loaded: ${found || "nothing"}.`,
    );
  }
  return loaded.digest;
}

function run(command: string, args: readonly string[]): Promise<string> {
  return new Promise((settle, reject) => {
    const child = spawn(command, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-16_384);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) settle(stdout);
      else
        reject(
          new OperationalError(
            `${parsePath(command).base} ${args[0]} failed (exit ${code}).`,
            stderr.trim() || undefined,
          ),
        );
    });
  });
}

async function requirePath(path: string, what: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new OperationalError(
      `Could not find the ${what} at ${path}.`,
      "Build it with `bun run runtime:build`, or point RADIUS_RUNTIME_HOST_PATH / RADIUS_KERNEL_PATH at an existing one.",
    );
  }
}

async function resolveDefaultRuntimeAssets(
  root: string,
): Promise<{ runtimeHostPath: string; kernelPath: string }> {
  const candidates = [root, join(root, ".."), join(root, "..", "..")];
  for (const candidate of candidates) {
    const host = join(
      candidate,
      "apps",
      "runtime-host-macos",
      ".build",
      "release",
      "radius-runtime-host",
    );
    try {
      await access(host);
      // The kernel moved under `runtime-assets/` when asset preparation was
      // split out of the Swift build; the old path is tried second so a stale
      // checkout still resolves.
      for (const kernel of [
        join(candidate, "apps", "runtime-host-macos", ".build", "runtime-assets", "vmlinux-arm64"),
        join(candidate, "apps", "runtime-host-macos", ".build", "vmlinux-arm64"),
      ]) {
        try {
          await access(kernel);
          return { runtimeHostPath: host, kernelPath: kernel };
        } catch {
          // Try the next known location.
        }
      }
    } catch {
      // Keep looking; a project outside the repo has neither.
    }
  }
  const shared = join(homedir(), ".radius", "runtime");
  return {
    runtimeHostPath: join(shared, "radius-runtime-host"),
    kernelPath: join(shared, "vmlinux-arm64"),
  };
}

/**
 * The agents a session says it can run.
 *
 * ACP has no agent list of its own, so a harness projects one through the
 * extension points it does have: `sessionModes` where the harness models an
 * agent as a mode, and a `mode`-category config option otherwise. Both are
 * read because harnesses differ, and an empty result is reported rather than
 * treated as a failure — a single-agent harness advertises neither.
 */
function advertisedAgents(session: {
  sessionModes: {
    availableModes?: ReadonlyArray<{ id?: string; name?: string }>;
  } | null | undefined;
  sessionConfigOptions: readonly SessionConfigOption[];
}): string[] {
  const fromModes = (session.sessionModes?.availableModes ?? [])
    .map((mode) => mode.id ?? mode.name)
    .filter((name): name is string => Boolean(name));
  if (fromModes.length > 0) return fromModes;

  const option = session.sessionConfigOptions.find(
    (candidate) => candidate.category === "mode" || candidate.id === "mode",
  );
  if (!option || option.type !== "select") return [];
  // A select's options are either a flat list or grouped; both shapes carry
  // the same leaf, so flatten rather than branch on which arrived.
  return option.options.flatMap((entry) =>
    "options" in entry
      ? entry.options.map((leaf) => leaf.value)
      : [entry.value],
  );
}
