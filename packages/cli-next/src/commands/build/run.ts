import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  AgentBuildReceiptSchema,
  type AgentBuildReceipt,
  type AgentConfig,
} from "@curve-ai/agent-contracts";
import {
  buildHarnessOciLayout,
  buildPythonOciLayout,
  buildTypeScriptOciLayout,
  canonicalJson,
  hostImagePlatform,
  type HostImagePlatform,
  isBuildError,
  type HarnessOciBuildResult,
  type PythonOciBuildResult,
  type TypeScriptOciBuildResult,
} from "@curve-ai/build";

import { loadConfigFile } from "../../config.js";
import { emitJson, type RadiusContext } from "../../context.js";
import {
  OperationalError,
  RuntimeUnavailableError,
  UsageError,
} from "../../errors.js";
import { handler } from "../../handler.js";
import { verifyBuild } from "../../verify.js";

interface BuildFlags {
  readonly "skip-verify": boolean;
  readonly config?: string;
  readonly platform?: string;
  readonly json: boolean;
}

type AnyBuildResult =
  TypeScriptOciBuildResult | PythonOciBuildResult | HarnessOciBuildResult;

async function run(this: RadiusContext, flags: BuildFlags): Promise<void> {
  const context = this;
  // --config names a file, not a directory. Resolving it to a directory and
  // then looking for radius.json inside meant `--config agent.prod.json`
  // silently built whatever radius.json held instead.
  const explicit = flags.config
    ? isAbsolute(flags.config)
      ? flags.config
      : resolve(context.cwd, flags.config)
    : null;
  // Paths in the receipt, and `include` in a harness config, are relative to
  // the project — which is the config's own directory, not wherever the
  // command happened to be run.
  const root = explicit ? dirname(explicit) : context.cwd;
  const loaded = await loadConfigFile(root, explicit);
  if (loaded.deprecation) context.note(loaded.deprecation);
  const config = loaded.config;

  if (!config.agent) {
    throw new UsageError(
      "This config has no agent id, so a build could not be imported. Run `radius init` to mint one.",
    );
  }

  const native = hostImagePlatform(
    context.process.platform,
    context.process.arch,
  );
  const platforms = parsePlatforms(flags.platform, native);

  const results: PlatformBuild[] = [];
  for (const platform of platforms) {
    context.out(
      platforms.length > 1
        ? `building ${config.name} for ${platform}`
        : `building ${config.name}`,
    );
    results.push(
      await buildPlatform({
        context,
        config,
        root,
        platform,
        native,
        skipVerify: flags["skip-verify"],
      }),
    );
    if (platforms.length > 1) context.out("");
  }

  // The native build is the one `latest` names, since it is the only one
  // this machine can run; every platform built is listed beside it.
  const primary =
    results.find((result) => result.platform === native) ?? results[0]!;
  await writeLatest(root, primary, results);

  if (context.output === "json") {
    emitJson(context, {
      ...describe(root, primary),
      builds: results.map((result) => describe(root, result)),
    });
  }
}

interface PlatformBuild {
  readonly platform: HostImagePlatform;
  readonly build: AnyBuildResult;
  readonly receipt: AgentBuildReceipt;
  readonly receiptPath: string;
  readonly verification: {
    readonly protocolVersion: number;
    readonly advertisedAgents: readonly string[];
  } | null;
}

/**
 * Which Linux images to build: the host's own by default, or the
 * comma-separated list in --platform (`all` for both).
 *
 * Every Radius app runs agents as Linux in a microVM, so these two cover all
 * of them: ARM64 for Apple Silicon Macs, AMD64 for Windows x64. Each one is
 * built as its own importable layout, because the importers take a layout
 * with exactly one image in it.
 */
export function parsePlatforms(
  value: string | undefined,
  native: HostImagePlatform,
): HostImagePlatform[] {
  if (value === undefined) return [native];
  const requested = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const chosen: HostImagePlatform[] = [];
  for (const name of requested) {
    const expanded = name === "all" ? BUILD_PLATFORMS : [name];
    for (const platform of expanded) {
      if (!isBuildPlatform(platform)) {
        throw new UsageError(
          `--platform ${name} is not a platform Radius builds. Use ${BUILD_PLATFORMS.join(", ")} or all, separated by commas.`,
        );
      }
      if (!chosen.includes(platform)) chosen.push(platform);
    }
  }
  if (chosen.length === 0) {
    throw new UsageError(
      `--platform needs at least one of ${BUILD_PLATFORMS.join(", ")} or all.`,
    );
  }
  return chosen;
}

const BUILD_PLATFORMS: readonly HostImagePlatform[] = [
  "linux/arm64",
  "linux/amd64",
];

function isBuildPlatform(value: string): value is HostImagePlatform {
  return (BUILD_PLATFORMS as readonly string[]).includes(value);
}

async function buildPlatform(input: {
  readonly context: RadiusContext;
  readonly config: AgentConfig;
  readonly root: string;
  readonly platform: HostImagePlatform;
  readonly native: HostImagePlatform;
  readonly skipVerify: boolean;
}): Promise<PlatformBuild> {
  const { context, config, root, platform } = input;
  // A build failure the builder could describe is an operational error with a
  // next action, not an internal defect. Without this an expected condition —
  // a harness with no Linux build, a Docker driver that cannot export OCI —
  // reached the developer as "Internal error, please report this".
  const build = await buildFor(config, root, platform, (message) =>
    context.out(`  ${message}`),
  ).catch((error: unknown) => {
    if (isBuildError(error)) {
      throw new OperationalError(error.message, error.nextAction);
    }
    throw error;
  });
  context.out(`  platform     ${platform}`);
  context.out(`  digest       ${build.buildDigest}`);
  context.out(`  release      ${build.releaseVersion}`);
  context.out(`  image        ${build.imageDigest}`);
  if ("summary" in build) {
    const summary = build.summary;
    context.out(`  harness      ${summary.harnessSha256.slice(0, 12)}…`);
    context.out(
      `  shipped      ${summary.includedFiles} project files${
        summary.toolchains.length
          ? `, toolchains: ${summary.toolchains.join(", ")}`
          : ""
      }`,
    );
  }

  let verification: PlatformBuild["verification"] = null;
  let skippedBecause: string | null = input.skipVerify ? "--skip-verify" : null;

  if (input.skipVerify) {
    context.note("Skipping microVM verification (--skip-verify).");
  } else if (platform !== input.native) {
    // A microVM boots only its host's own architecture. The image is still
    // the deliverable; the receipt says plainly that it was never booted, so
    // nothing downstream mistakes it for a checked one.
    skippedBecause = `built for ${platform}, and this machine can boot only ${input.native}`;
    context.note(`Not verified: ${skippedBecause}.`);
  } else {
    // A missing runtime stops the check, not the build. The layout is the
    // deliverable and it is already correct; refusing to write it would mean
    // a developer with no desktop app installed could not build at all.
    const result = await verifyBuild({ root, config, build, context }).catch(
      (error: unknown) => {
        // Only an absent runtime is a skip. An image that will not boot, a
        // missing release template or a runtime host that fails are failed
        // builds, and reporting them as "not verified" with exit 0 would make
        // a broken image indistinguishable from an unverifiable machine.
        if (error instanceof RuntimeUnavailableError) {
          skippedBecause = error.message;
          return null;
        }
        throw error;
      },
    );
    if (result === null) {
      context.note("");
      context.note(`Not verified: ${skippedBecause}`);
      context.note(
        "The image is built and the receipt records that it was never booted.",
      );
    } else {
      verification = {
        protocolVersion: result.protocolVersion,
        advertisedAgents: result.advertisedAgents,
      };
      context.out(`  verified     ACP v${result.protocolVersion}`);
      // Named rather than counted: the point is whether these are the project's
      // own agents or the harness's defaults, and only a name shows that.
      context.out(
        `  agents       ${
          result.advertisedAgents.length > 0
            ? result.advertisedAgents.join(", ")
            : "none advertised — this agent offers one"
        }`,
      );
      if (result.authMethods.length > 0) {
        context.out(`  auth         ${result.authMethods.join(", ")}`);
      }
    }
  }

  const receipt = AgentBuildReceiptSchema.parse({
    schemaVersion: 1,
    buildDigest: build.buildDigest,
    imageReference: build.imageReference,
    sourceManifestDigest: build.imageDigest,
    bundleSha256: build.bundleSha256,
    layoutPath: projectRelative(root, build.layoutPath),
    contextPath: projectRelative(root, build.contextPath),
    manifest: build.manifest,
    release: {
      version: build.releaseVersion,
      templateEmbedded: true,
      indexPath: projectRelative(root, build.indexPath),
    },
    verifiedAt: new Date().toISOString(),
    verification: {
      kind: "microvm-acp",
      platform,
      verified: verification !== null,
      ...(verification === null && skippedBecause ? { skippedBecause } : {}),
      ...(verification
        ? { advertisedAgents: [...verification.advertisedAgents] }
        : {}),
    },
  });

  const receiptPath = await writeReceipt(root, receipt);
  context.out(`  receipt      ${projectRelative(root, receiptPath)}`);
  return { platform, build, receipt, receiptPath, verification };
}

function describe(root: string, result: PlatformBuild) {
  return {
    platform: result.platform,
    buildDigest: result.receipt.buildDigest,
    releaseVersion: result.build.releaseVersion,
    imageDigest: result.build.imageDigest,
    layoutPath: result.receipt.layoutPath,
    receiptPath: projectRelative(root, result.receiptPath),
    verified: result.verification !== null,
    protocolVersion: result.verification?.protocolVersion ?? null,
    advertisedAgents: result.verification?.advertisedAgents ?? null,
  };
}

/**
 * One builder per runtime kind, chosen exhaustively.
 *
 * Written as a switch over every member rather than a ternary with a
 * fall-through default: the previous shape silently routed an unknown kind to
 * the TypeScript builder, which is how a harness config ended up being asked
 * for an entrypoint it does not have.
 */
async function buildFor(
  config: AgentConfig,
  root: string,
  platform: HostImagePlatform,
  onProgress: (message: string) => void,
): Promise<AnyBuildResult> {
  switch (config.runtime.kind) {
    case "typescript":
      return buildTypeScriptOciLayout({ root, config, platform });
    case "python":
      return buildPythonOciLayout({ root, config, platform });
    case "harness": {
      // Specified in the harness-packaging work but not built: a pinned
      // package does not pin its transitive dependencies, so npx and uvx need
      // a committed lockfile to install from before a build can be
      // reproducible. Refused as a usage error rather than attempted, so the
      // developer is told instead of handed a container-build failure.
      const distribution = config.runtime.distribution.kind;
      if (distribution !== "binary") {
        throw new UsageError(
          `radius build cannot package a "${distribution}" harness yet — only "binary" distributions are implemented.\n\n` +
            "`radius dev` runs this harness today; packaging it needs a lockfile so the build stays reproducible.",
        );
      }
      return buildHarnessOciLayout({ root, config, platform, onProgress });
    }
    case "langgraph":
      // The image would need the adapter and the project's graph
      // dependencies installed from its lockfile; until that exists a build
      // would ship a graph that cannot import. Refused up front for the same
      // reason as the npx/uvx harnesses, and for either language.
      throw new UsageError(
        `radius build cannot package a "langgraph" runtime yet (Python or TypeScript graphs).\n\n` +
          "`radius dev` and `radius check` run these graphs today.",
      );
    case "command":
      throw new UsageError(
        'runtime.kind "command" is an argv with no source, so there is nothing to package. Declare a harness instead — `radius init --harness <id>`.',
      );
  }
}

async function writeReceipt(
  root: string,
  receipt: AgentBuildReceipt,
): Promise<string> {
  const directory = join(root, ".radius", "builds", receipt.buildDigest);
  await mkdir(directory, { recursive: true });
  const receiptPath = join(directory, "receipt.json");
  await writeFile(receiptPath, canonicalJson(receipt), {
    encoding: "utf8",
    mode: 0o600,
  });
  return receiptPath;
}

/**
 * `buildDigest` stays the one build a reader of the old shape expects, the
 * native one; `platforms` adds every platform this run built.
 */
async function writeLatest(
  root: string,
  primary: PlatformBuild,
  results: readonly PlatformBuild[],
): Promise<void> {
  await writeFile(
    join(root, ".radius", "builds", "latest.json"),
    canonicalJson({
      schemaVersion: 1,
      buildDigest: primary.receipt.buildDigest,
      platforms: Object.fromEntries(
        results.map((result) => [result.platform, result.receipt.buildDigest]),
      ),
    }),
    { encoding: "utf8", mode: 0o600 },
  );
}

function projectRelative(root: string, target: string): string {
  const relativePath = relative(root, target).replaceAll("\\", "/");
  return relativePath.startsWith("..") ? target : relativePath;
}

export default handler<BuildFlags, []>(run);
