import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

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
  type HarnessOciBuildResult,
  type PythonOciBuildResult,
  type TypeScriptOciBuildResult,
} from "@curve-ai/build";

import { loadConfigFile } from "../../config.js";
import { emitJson, type RadiusContext } from "../../context.js";
import { UsageError } from "../../errors.js";
import { handler } from "../../handler.js";
import { verifyBuild } from "../../verify.js";

interface BuildFlags {
  readonly "skip-verify": boolean;
  readonly config?: string;
  readonly json: boolean;
}

type AnyBuildResult =
  | TypeScriptOciBuildResult
  | PythonOciBuildResult
  | HarnessOciBuildResult;

async function run(this: RadiusContext, flags: BuildFlags): Promise<void> {
  const context = this;
  const root = context.cwd;
  const loaded = await loadConfigFile(
    flags.config ? dirnameOf(root, flags.config) : root,
  );
  if (loaded.deprecation) context.note(loaded.deprecation);
  const config = loaded.config;

  if (!config.agent) {
    throw new UsageError(
      "This config has no agent id, so a build could not be imported. Run `radius init` to mint one.",
    );
  }

  context.out(`building ${config.name}`);
  const build = await buildFor(config, root, (message) =>
    context.out(`  ${message}`),
  );
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

  let verification: {
    protocolVersion: number;
    advertisedAgents: readonly string[];
  } | null = null;
  if (!flags["skip-verify"]) {
    const result = await verifyBuild({ root, config, build, context });
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
  } else {
    context.note("Skipping microVM verification (--skip-verify).");
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
    verification: { kind: "microvm-acp", platform: "linux/arm64" },
  });

  const receiptPath = await writeReceipt(root, receipt);

  if (context.output === "json") {
    emitJson(context, {
      buildDigest: receipt.buildDigest,
      releaseVersion: build.releaseVersion,
      imageDigest: build.imageDigest,
      layoutPath: receipt.layoutPath,
      receiptPath: projectRelative(root, receiptPath),
      verified: verification !== null,
      protocolVersion: verification?.protocolVersion ?? null,
      advertisedAgents: verification?.advertisedAgents ?? null,
    });
    return;
  }
  context.out(`  receipt      ${projectRelative(root, receiptPath)}`);
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
  onProgress: (message: string) => void,
): Promise<AnyBuildResult> {
  switch (config.runtime.kind) {
    case "typescript":
      return buildTypeScriptOciLayout({ root, config });
    case "python":
      return buildPythonOciLayout({ root, config });
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
      return buildHarnessOciLayout({ root, config, onProgress });
    }
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
  await writeFile(
    join(root, ".radius", "builds", "latest.json"),
    canonicalJson({ schemaVersion: 1, buildDigest: receipt.buildDigest }),
    { encoding: "utf8", mode: 0o600 },
  );
  return receiptPath;
}

function dirnameOf(root: string, configPath: string): string {
  const absolute = isAbsolute(configPath) ? configPath : resolve(root, configPath);
  return absolute.replace(/\/[^/]+$/, "");
}

function projectRelative(root: string, target: string): string {
  const relativePath = relative(root, target);
  return relativePath.startsWith("..") ? target : relativePath;
}

export default handler<BuildFlags, []>(run);
