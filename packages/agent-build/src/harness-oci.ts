import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, posix, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

import {
  AgentConfigSchema,
  type AgentConfigInput,
  type AgentManifest,
  type HarnessRuntimeConfig,
  type HarnessToolchain,
} from "@curve-ai/agent-contracts";

import { BuildError } from "./errors.js";
import type { OciCommandRunner } from "./push.js";
import { hostImagePlatform, type HostImagePlatform } from "./host-image.js";
import { canonicalJson, createAgentManifest } from "./manifest.js";
import {
  releaseTemplateLabels,
  synthesiseReleaseTemplate,
} from "./release-template.js";
import { writeImportableLayout } from "./importable.js";

/**
 * Packaging for a third-party harness.
 *
 * Unlike the TypeScript and Python builders there is nothing to compile. The
 * harness is a pinned archive, and the agent is the project tree around it —
 * agents as markdown, tools the harness discovers by reading a directory.
 * So this builder ships bytes rather than a bundle, and the entrypoint is the
 * harness's own command.
 */

/** Guest is always Linux; only the architecture varies. */
const TARGET_PLATFORM = hostImagePlatform();
const REGISTRY_ARCH = TARGET_PLATFORM.split("/")[1]!;

/**
 * Pinned by index digest, so the same config builds the same bytes. Each
 * serves one purpose and is only pulled when a project needs it.
 */
const BASE_IMAGES = {
  /** No toolchain: the harness is the whole agent. */
  plain:
    "debian:bookworm-slim@sha256:7ff6ba31527b9e336162fa061746c366c4b2032f4d2cff2078bea43f78efe3f8",
  /** Carries uv and a CPython, for a project whose tools are Python. */
  python:
    "ghcr.io/astral-sh/uv:python3.12-bookworm-slim@sha256:e5b65587bce7de595f299855d7385fe7fca39b8a74baa261ba1b7147afa78e58",
  /** Only `bun` is copied out of this one; it is never the base. */
  bun: "oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4",
} as const;

/**
 * Compressed size of each pinned base, measured once.
 *
 * `rootfsMb` goes into the release template, which is embedded in the image
 * being built, so it cannot be measured from that image's own output. These
 * are constants that change only when a digest above changes; the harness
 * archive and the project tree are the variables, and both are known before
 * the build. `writeImportableLayout`'s post-build check fails loudly if an
 * estimate ever undershoots.
 */
const BASE_COMPRESSED_BYTES = {
  plain: 30_000_000,
  python: 70_000_000,
} as const;

/** Adding bun costs its own binary, which is not small. */
const BUN_COMPRESSED_BYTES = 60_000_000;

/** A harness is a developer tool, not a disk image. */
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

export interface HarnessOciBuildOptions {
  root: string;
  config: AgentConfigInput;
  outputRoot?: string;
  dockerExecutable?: string;
  platform?: HostImagePlatform;
  commandRunner?: OciCommandRunner;
  onProgress?: (message: string) => void;
}

export interface HarnessOciBuildResult {
  buildDigest: string;
  imageReference: string;
  imageDigest: `sha256:${string}`;
  layoutPath: string;
  contextPath: string;
  manifest: AgentManifest;
  /**
   * Named `bundleSha256` for receipt compatibility; for a harness it digests
   * the shipped file set rather than a compiled bundle. Empty tree, empty set
   * digest — the harness archive still enters `buildDigest` separately.
   */
  bundleSha256: string;
  releaseVersion: string;
  indexPath: string;
  /** What the image actually carries, for the CLI to report. */
  summary: {
    harnessSha256: string;
    harnessSource: string;
    includedFiles: number;
    includedBytes: number;
    toolchains: readonly string[];
  };
}

export async function buildHarnessOciLayout(
  options: HarnessOciBuildOptions,
): Promise<HarnessOciBuildResult> {
  const config = AgentConfigSchema.parse(options.config);
  if (config.runtime.kind !== "harness") {
    throw new Error("Harness OCI build requires a harness runtime config");
  }
  const platform = options.platform ?? hostImagePlatform();
  const runner = options.commandRunner;
  const run = runner
    ? (command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) =>
        runner({ command, args, cwd, env }).then(() => {})
    : runCommand;
  const runtime = config.runtime;
  const report = options.onProgress ?? (() => {});

  const outputRoot =
    options.outputRoot ?? join(options.root, ".radius", "builds");
  await mkdir(outputRoot, { recursive: true });
  const temporaryRoot = await mkdtemp(join(outputRoot, ".sandbox-"));
  const contextPath = join(temporaryRoot, "context");
  await mkdir(contextPath, { recursive: true });

  try {
    const launch = resolveLaunch(runtime, platform);
    const harness = await stageHarness({
      runtime,
      platform,
      root: options.root,
      contextPath,
      report,
    });
    const tree = await stageProjectTree({
      root: options.root,
      include: runtime.include,
      contextPath,
      report,
    });
    await writeNotices(contextPath, runtime, report);

    const manifest = createAgentManifest(config);
    const manifestJson = canonicalJson(manifest);

    // No compiled bundle to hash, so identity comes from the manifest, the
    // pinned harness, and the bytes of the tree. Same guarantee, different
    // inputs: two builds of identical input produce one digest.
    const buildDigest = createHash("sha256")
      .update(manifestJson)
      .update(platform)
      .update(harness.sha256)
      .update(tree.digest)
      .digest("hex");
    const imageReference = `radius.local/dev/${safeImageName(config.name)}:${buildDigest.slice(0, 16)}`;

    const estimatedMb = estimateHarnessImageMb({
      harnessBytes: harness.archiveBytes,
      treeBytes: tree.bytes,
      toolchains: runtime.toolchains,
    });
    const template = synthesiseReleaseTemplate({
      config,
      buildDigest,
      imageReference,
      platform,
      processArguments: launch.processArguments,
      imageSizeMb: estimatedMb,
    });

    await writeFile(
      join(contextPath, "Containerfile"),
      renderHarnessContainerfile({ runtime, launch, hasTree: tree.count > 0 }),
      "utf8",
    );
    await writeFile(join(contextPath, "manifest.json"), manifestJson, "utf8");

    report(`Building ${imageReference} for ${platform}…`);
    const imageTarPath = join(temporaryRoot, "image.oci.tar");
    const loadAndSave = process.platform === "win32";
    await run(
      options.dockerExecutable ?? "docker",
      [
        "buildx",
        "build",
        "--platform",
        platform,
        "--provenance=false",
        "--sbom=false",
        "--build-arg",
        "SOURCE_DATE_EPOCH=0",
        "--tag",
        imageReference,
        ...Object.entries(releaseTemplateLabels(template)).flatMap(
          ([key, value]) => ["--label", `${key}=${value}`],
        ),
        ...(loadAndSave
          ? ["--load"]
          : ["--output", `type=oci,dest=${imageTarPath}`]),
        "--file",
        join(contextPath, "Containerfile"),
        contextPath,
      ],
      options.root,
    );

    if (loadAndSave) {
      await run(
        options.dockerExecutable ?? "docker",
        ["save", "--output", imageTarPath, imageReference],
        options.root,
      );
    }

    const layoutPath = join(temporaryRoot, "oci-layout");
    await mkdir(layoutPath, { recursive: true });
    await run("tar", ["-xf", imageTarPath, "-C", layoutPath], options.root);
    await rm(imageTarPath, { force: true });

    const { imageDigest, imageSizeMb } = await writeImportableLayout({
      layoutPath,
      imageReference,
      platform,
      agentId: config.agent!,
      outputRoot: temporaryRoot,
    });

    if (imageSizeMb > estimatedMb) {
      throw new BuildError(
        `Built image is larger than the release template claims (${Math.ceil(imageSizeMb)}MB > ${estimatedMb}MB). Raise the estimate in harness-oci.ts.`,
      );
    }

    const finalRoot = join(outputRoot, buildDigest);
    await rm(finalRoot, { recursive: true, force: true });
    await rename(temporaryRoot, finalRoot);
    return {
      buildDigest,
      imageReference,
      imageDigest,
      layoutPath: join(finalRoot, "oci-layout"),
      contextPath: join(finalRoot, "context"),
      manifest,
      bundleSha256: tree.digest,
      releaseVersion: String(template.releaseVersion),
      indexPath: join(finalRoot, "index.json"),
      summary: {
        harnessSha256: harness.sha256,
        harnessSource: harness.source,
        includedFiles: tree.count,
        includedBytes: tree.bytes,
        toolchains: runtime.toolchains.map((toolchain) => toolchain.kind),
      },
    };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

interface ResolvedLaunch {
  /** What the guest runs. Absolute, because the guest has no project cwd. */
  readonly processArguments: readonly string[];
  readonly entrypoint: readonly string[];
}

/**
 * The entrypoint is the harness's own command, which is what makes ACP
 * arrive with the harness rather than being asked of the project.
 */
function resolveLaunch(
  runtime: HarnessRuntimeConfig,
  platform: HostImagePlatform,
): ResolvedLaunch {
  const distribution = runtime.distribution;
  if (distribution.kind === "binary") {
    const artifact = distribution.platforms[platform];
    const command = artifact?.cmd ?? distribution.cmd;
    const args = artifact?.args ?? distribution.args;
    // Registry commands are written for a cwd that contains the extracted
    // archive (`./opencode`); the guest has no such cwd, so anchor them.
    const absolute = posix.join("/opt/agent", command.replace(/^\.\//, ""));
    return {
      processArguments: [absolute, ...args],
      entrypoint: [absolute, ...args],
    };
  }
  if (distribution.kind === "npx") {
    return {
      processArguments: [
        "npx",
        "-y",
        distribution.package,
        ...distribution.args,
      ],
      entrypoint: ["npx", "-y", distribution.package, ...distribution.args],
    };
  }
  return {
    processArguments: ["uvx", distribution.package, ...distribution.args],
    entrypoint: ["uvx", distribution.package, ...distribution.args],
  };
}

interface StagedHarness {
  readonly sha256: string;
  readonly source: string;
  readonly archiveBytes: number;
}

/**
 * Fetches the Linux build of the harness and verifies it before it is staged.
 *
 * `dev` resolves the host's own platform; a build always wants the guest's.
 * The config already carries every platform the registry published, so this
 * reads a different key rather than a different source of truth.
 */
async function stageHarness(input: {
  runtime: HarnessRuntimeConfig;
  platform: HostImagePlatform;
  root: string;
  contextPath: string;
  report: (message: string) => void;
}): Promise<StagedHarness> {
  const platform = input.platform;
  const distribution = input.runtime.distribution;
  if (distribution.kind !== "binary") {
    // npx and uvx install inside the image from a pinned package, so there is
    // no archive to stage here. The digest still has to come from somewhere
    // stable, so it is the pin itself.
    return {
      sha256: createHash("sha256").update(distribution.package).digest("hex"),
      source: `${distribution.kind} ${distribution.package}`,
      archiveBytes: 0,
    };
  }

  const artifact = distribution.platforms[platform];
  if (!artifact) {
    const published = Object.keys(distribution.platforms).sort().join(", ");
    throw new BuildError(
      `This harness publishes no ${platform} build, so it cannot run in a Radius microVM. It ships: ${published}.`,
    );
  }

  const destination = join(input.contextPath, "harness-archive");
  if (!/^https?:\/\//.test(artifact.archive)) {
    const source = resolve(input.root, artifact.archive);
    const bytes = await readFile(source);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (artifact.sha256 && artifact.sha256 !== digest) {
      throw new BuildError(
        `${artifact.archive} does not match the sha256 in config (expected ${artifact.sha256}, got ${digest}).`,
      );
    }
    await writeFile(destination, bytes);
    input.report(
      `Staged harness from ${artifact.archive} (${digest.slice(0, 12)}…)`,
    );
    return { sha256: digest, source, archiveBytes: bytes.byteLength };
  }

  if (!artifact.sha256) {
    throw new BuildError(
      `The ${platform} archive is a URL but carries no sha256. Radius will not package an unverified harness.`,
    );
  }

  // Content-addressed, so a rebuild — or a second project pinning the same
  // build — reuses the bytes instead of pulling 80MB again. `dev` already
  // caches the extracted harness this way; a build needs the archive itself,
  // which is why this is a sibling directory rather than the same one.
  const cached = join(
    homedir(),
    ".radius",
    "harnesses",
    "archives",
    `${artifact.sha256}-${platform.replace("/", "-")}`,
  );
  let bytes: number;
  if (await fileExists(cached)) {
    const contents = await readFile(cached);
    // Re-verified on read: a cache is a place on disk like any other, and the
    // digest is the only reason to trust what is in it.
    const digest = createHash("sha256").update(contents).digest("hex");
    if (digest === artifact.sha256) {
      await writeFile(destination, contents);
      input.report(`Using the cached ${platform} harness`);
      return {
        sha256: artifact.sha256,
        source: artifact.archive,
        archiveBytes: contents.byteLength,
      };
    }
    await rm(cached, { force: true });
  }

  input.report(`Downloading the ${platform} harness…`);
  bytes = await download(artifact.archive, artifact.sha256, destination);
  await mkdir(dirname(cached), { recursive: true, mode: 0o700 });
  // Copied rather than moved: the build context is temporary and gets removed.
  await writeFile(cached, await readFile(destination));
  return {
    sha256: artifact.sha256,
    source: artifact.archive,
    archiveBytes: bytes,
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function download(
  url: string,
  expected: string,
  destination: string,
): Promise<number> {
  // `fetch` itself throws on DNS failure, a refused connection or a dropped
  // socket — none of which is a defect in Radius, and all of which reached
  // the developer as "Internal error, please report this".
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new BuildError(
      `Could not reach the harness download: ${(error as Error).message}`,
      `URL: ${url}\nCheck the network, or the archive URL in radius.json.`,
    );
  }
  if (!response.ok || !response.body) {
    throw new BuildError(
      `Downloading the harness failed: ${response.status} ${response.statusText} (${url})`,
    );
  }
  const hash = createHash("sha256");
  let received = 0;
  const sink = createWriteStream(destination);
  await pipeline(
    (async function* () {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        received += chunk.byteLength;
        if (received > MAX_ARCHIVE_BYTES) {
          throw new BuildError(
            `The harness archive exceeds ${MAX_ARCHIVE_BYTES / (1024 * 1024)}MB.`,
          );
        }
        hash.update(chunk);
        yield chunk;
      }
    })(),
    sink,
  );
  const digest = hash.digest("hex");
  if (digest !== expected) {
    await rm(destination, { force: true });
    throw new BuildError(
      `The harness archive does not match its pinned sha256 (expected ${expected}, got ${digest}).`,
    );
  }
  return received;
}

interface StagedTree {
  readonly digest: string;
  readonly count: number;
  readonly bytes: number;
}

/**
 * Copies the declared file set into the build context and digests it.
 *
 * The digest is over sorted `path\0sha256` pairs rather than over an archive,
 * so it does not depend on tar ordering, timestamps or compression — two
 * builds of the same tree agree even across machines.
 */
async function stageProjectTree(input: {
  root: string;
  include: readonly string[];
  contextPath: string;
  report: (message: string) => void;
}): Promise<StagedTree> {
  if (input.include.length === 0) {
    return { digest: createHash("sha256").digest("hex"), count: 0, bytes: 0 };
  }

  const stageRoot = join(input.contextPath, "tree");
  await mkdir(stageRoot, { recursive: true });
  const entries: Array<{ path: string; sha256: string; bytes: number }> = [];

  for (const declared of input.include) {
    const relativePath = declared.replace(/\/+$/, "");
    const source = resolve(input.root, relativePath);
    let info;
    try {
      info = await stat(source);
    } catch {
      throw new BuildError(
        `runtime.include names ${declared}, which does not exist in the project.`,
      );
    }
    if (info.isDirectory()) {
      await collectDirectory(source, relativePath, stageRoot, entries);
    } else {
      await copyInto(source, relativePath, stageRoot, entries);
    }
  }

  entries.sort((left, right) => left.path.localeCompare(right.path));
  const hash = createHash("sha256");
  for (const entry of entries) hash.update(`${entry.path}\0${entry.sha256}\0`);
  const bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  input.report(
    `Staged ${entries.length} project files (${(bytes / (1024 * 1024)).toFixed(1)}MB)`,
  );
  return { digest: hash.digest("hex"), count: entries.length, bytes };
}

/**
 * Directories a developer would never mean to ship. Shipping `node_modules`
 * or a host `.venv` would bake a macOS build into a Linux image, so these are
 * skipped rather than trusted to the declaration.
 */
const NEVER_SHIP = new Set([
  "node_modules",
  ".venv",
  "__pycache__",
  ".git",
  ".radius",
  ".DS_Store",
]);

async function collectDirectory(
  source: string,
  relativePath: string,
  stageRoot: string,
  entries: Array<{ path: string; sha256: string; bytes: number }>,
): Promise<void> {
  for (const child of await readdir(source, { withFileTypes: true })) {
    if (NEVER_SHIP.has(child.name)) continue;
    const childSource = join(source, child.name);
    const childRelative = posix.join(relativePath, child.name);
    if (child.isDirectory()) {
      await collectDirectory(childSource, childRelative, stageRoot, entries);
    } else if (child.isFile()) {
      await copyInto(childSource, childRelative, stageRoot, entries);
    }
    // Symlinks are skipped: a link out of the project would escape it, and a
    // link inside it is already covered by the file it points at.
  }
}

async function copyInto(
  source: string,
  relativePath: string,
  stageRoot: string,
  entries: Array<{ path: string; sha256: string; bytes: number }>,
): Promise<void> {
  const target = join(stageRoot, relativePath);
  // Belt and braces: the schema rejects `..`, and this rejects anything that
  // still resolves outside the staging root.
  if (relative(stageRoot, target).startsWith("..")) {
    throw new Error(`runtime.include escapes the project: ${relativePath}`);
  }
  await mkdir(dirname(target), { recursive: true });
  const bytes = await readFile(source);
  await writeFile(target, bytes);
  entries.push({
    path: relativePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
  });
}

/** Licences are recorded, never gated. A missing one is a warning. */
async function writeNotices(
  contextPath: string,
  runtime: HarnessRuntimeConfig,
  report: (message: string) => void,
): Promise<void> {
  const noticesPath = join(contextPath, "notices");
  await mkdir(noticesPath, { recursive: true });
  if (!runtime.license && !runtime.licenseUrl) {
    report(
      "This harness declares no licence. Packaging it anyway; notices/ will say so.",
    );
  }
  const lines = [
    `harness: ${runtime.registryId ?? runtime.distribution.kind}`,
    `license: ${runtime.license ?? "not declared"}`,
    `licenseUrl: ${runtime.licenseUrl ?? "not declared"}`,
    "",
  ];
  await writeFile(join(noticesPath, "HARNESS.txt"), lines.join("\n"), "utf8");
}

/**
 * Expansion factors, measured rather than guessed.
 *
 * Compressed layers do not all expand alike, and treating them as if they do
 * undershot a real opencode image by 300MB. A harness archive is one large
 * self-contained executable with an embedded runtime, which compresses far
 * better than a base image's many small files — a 78MB archive became a
 * 716MB rootfs. The post-build check in `writeImportableLayout` is what
 * caught that, and it stays the backstop for every number here.
 */
const BASE_EXPANSION = 4;
const HARNESS_EXPANSION = 8;
const TREE_EXPANSION = 4;
/** Filesystem overhead and the slack a guest needs to boot at all. */
const ROOTFS_HEADROOM_BYTES = 128_000_000;

export function estimateHarnessImageMb(input: {
  harnessBytes: number;
  treeBytes: number;
  toolchains: readonly HarnessToolchain[];
}): number {
  const python = input.toolchains.some(
    (toolchain) => toolchain.kind === "python",
  );
  const node = input.toolchains.some((toolchain) => toolchain.kind === "node");
  const base =
    (python ? BASE_COMPRESSED_BYTES.python : BASE_COMPRESSED_BYTES.plain) +
    (node ? BUN_COMPRESSED_BYTES : 0);
  // Installed dependencies are the one input not known before the build, so
  // the allowance is deliberately generous; undershooting fails the build.
  const dependencyAllowance = input.toolchains.length * 250_000_000;
  const total =
    base * BASE_EXPANSION +
    input.harnessBytes * HARNESS_EXPANSION +
    input.treeBytes * TREE_EXPANSION +
    dependencyAllowance +
    ROOTFS_HEADROOM_BYTES;
  return Math.ceil(total / (1024 * 1024));
}

export function renderHarnessContainerfile(input: {
  runtime: HarnessRuntimeConfig;
  launch: ResolvedLaunch;
  hasTree: boolean;
}): string {
  const { runtime, launch, hasTree } = input;
  const python = runtime.toolchains.find(
    (toolchain) => toolchain.kind === "python",
  );
  const node = runtime.toolchains.find(
    (toolchain) => toolchain.kind === "node",
  );
  const configRoot = runtime.configRoot;
  const lines: string[] = [];

  if (node) lines.push(`FROM ${BASE_IMAGES.bun} AS bun`, "");
  lines.push(`FROM ${python ? BASE_IMAGES.python : BASE_IMAGES.plain}`, "");

  lines.push(
    "RUN groupadd --gid 10000 radius \\",
    "  && useradd --uid 10000 --gid 10000 --home-dir /opt/data --no-create-home radius \\",
    `  && mkdir -p /opt/agent /opt/data ${configRoot} \\`,
    `  && chown -R 10000:10000 /opt/agent /opt/data ${configRoot}`,
    "",
  );

  if (runtime.distribution.kind === "binary") {
    // The whole archive is extracted, not one file: a harness may ship
    // sidecar assets beside its executable, and goose-style archives do.
    lines.push(
      "COPY harness-archive /tmp/harness-archive",
      "RUN set -eu; \\",
      "  case \"$(head -c 4 /tmp/harness-archive | od -An -tx1 | tr -d ' \\n')\" in \\",
      "    504b0304*) apt-get update && apt-get install -y --no-install-recommends unzip \\",
      "               && rm -rf /var/lib/apt/lists/* \\",
      "               && unzip -q /tmp/harness-archive -d /opt/agent ;; \\",
      "    *) tar -xf /tmp/harness-archive -C /opt/agent ;; \\",
      "  esac; \\",
      "  rm -f /tmp/harness-archive; \\",
      `  test -x ${launch.entrypoint[0]} || (echo "harness archive does not contain ${launch.entrypoint[0]}" >&2; exit 1); \\`,
      "  chown -R 10000:10000 /opt/agent",
      "",
    );
  }

  if (node) {
    lines.push(
      "COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun",
      // Harness packages ship `#!/usr/bin/env node` shebangs; bun answers.
      "RUN ln -sf /usr/local/bin/bun /usr/local/bin/node \\",
      "  && ln -sf /usr/local/bin/bun /usr/local/bin/bunx",
      "",
    );
  }

  lines.push("COPY --chown=10000:10000 manifest.json /opt/agent/manifest.json");
  lines.push("COPY --chown=10000:10000 notices /opt/agent/notices");
  if (hasTree) {
    lines.push(`COPY --chown=10000:10000 tree/ ${configRoot}/`);
  }
  lines.push("");

  // Dependencies install as the agent user, so a lockfile install cannot
  // write anywhere the running agent could not have written anyway.
  if (python || node) lines.push("USER 10000:10000");
  if (python) {
    const projectDirectory = posix.join(
      configRoot,
      posix.dirname(python.lockfile),
    );
    lines.push(
      `WORKDIR ${projectDirectory}`,
      "ENV UV_PYTHON_DOWNLOADS=never UV_PROJECT_ENVIRONMENT=/opt/agent/venv",
      "RUN uv sync --frozen --no-dev --no-install-project",
      "",
    );
  }
  if (node) {
    const installIn = node.installIn ?? posix.dirname(node.lockfile);
    lines.push(
      `WORKDIR ${posix.join(configRoot, installIn)}`,
      "RUN bun install --frozen-lockfile --production",
      "",
    );
  }

  lines.push(
    "USER 10000:10000",
    `ENV HOME=${configRoot}`,
    'ENV PATH="/opt/agent/venv/bin:/usr/local/bin:/usr/bin:/bin"',
    `WORKDIR ${configRoot}`,
    `ENTRYPOINT [${launch.entrypoint.map((part) => JSON.stringify(part)).join(", ")}]`,
    "",
  );
  return lines.join("\n");
}

function safeImageName(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || basename(process.cwd()).toLowerCase();
}

/** Exported so a caller can say which architecture was not built. */
export const HARNESS_TARGET_PLATFORM = TARGET_PLATFORM;
export const HARNESS_REGISTRY_ARCH = REGISTRY_ARCH;

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-16_384);
    });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      // Radius needs an OCI layout, which the default docker driver cannot
      // export. The raw message names neither Radius nor the fix.
      if (/OCI exporter is not supported for the docker driver/.test(stderr)) {
        rejectRun(
          new BuildError(
            "This Docker builder cannot export an OCI layout, which is the only thing Radius can ship.\n" +
              "Create one once with:\n" +
              "  docker buildx create --name radius-oci --driver docker-container --bootstrap\n" +
              "then build with BUILDX_BUILDER=radius-oci.",
          ),
        );
        return;
      }
      rejectRun(
        new Error(`${command} ${args[0]} failed (exit ${code}).\n${stderr}`),
      );
    });
  });
}
