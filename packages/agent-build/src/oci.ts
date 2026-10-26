import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";

import {
  AgentConfigSchema,
  type AgentConfigInput,
  type AgentManifest,
} from "@curve-ai/agent-contracts";
import { build } from "esbuild";

import { BuildError } from "./errors.js";
import type { OciCommandRunner } from "./push.js";
import { hostImagePlatform, type HostImagePlatform } from "./host-image.js";
import { canonicalJson, createAgentManifest } from "./manifest.js";
import {
  releaseTemplateLabels,
  synthesiseReleaseTemplate,
} from "./release-template.js";
import { writeImportableLayout } from "./importable.js";

const NODE_IMAGE =
  "node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5";

/**
 * Compressed size of the pinned base image's layers, measured once.
 *
 * `rootfsMb` has to go into the release template, which is embedded in the
 * image being built — so it cannot be measured from that image's own output.
 * The base is pinned by digest, so its size is a constant that changes only
 * when the digest above changes; the agent bundle is the only variable, and
 * its size is known before the build. The post-build check in
 * `writeImportableLayout` fails loudly if this estimate ever undershoots.
 */
const BASE_IMAGE_COMPRESSED_BYTES = 80_000_000;

export interface TypeScriptOciBuildOptions {
  root: string;
  config: AgentConfigInput;
  outputRoot?: string;
  dockerExecutable?: string;
  platform?: HostImagePlatform;
  commandRunner?: OciCommandRunner;
}

export interface TypeScriptOciBuildResult {
  buildDigest: string;
  imageReference: string;
  imageDigest: `sha256:${string}`;
  layoutPath: string;
  contextPath: string;
  manifest: AgentManifest;
  bundleSha256: string;
  /** The release version embedded in the layout, `<version>+<digest16>`. */
  releaseVersion: string;
  /** Where the bundled-agent index entry was written. */
  indexPath: string;
}

export async function buildTypeScriptOciLayout(
  options: TypeScriptOciBuildOptions,
): Promise<TypeScriptOciBuildResult> {
  const config = AgentConfigSchema.parse(options.config);
  if (config.runtime.kind !== "typescript") {
    throw new Error(
      "TypeScript OCI build requires a TypeScript runtime config",
    );
  }

  const platform = options.platform ?? hostImagePlatform();
  const runner = options.commandRunner;
  const run = runner
    ? (command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) =>
        runner({ command, args, cwd, env }).then(() => {})
    : runCommand;
  const outputRoot =
    options.outputRoot ?? join(options.root, ".radius", "builds");
  await mkdir(outputRoot, { recursive: true });
  const temporaryRoot = await mkdtemp(join(outputRoot, ".sandbox-"));
  const contextPath = join(temporaryRoot, "context");
  await mkdir(contextPath, { recursive: true });

  try {
    const bundlePath = join(contextPath, "agent.mjs");
    await build({
      entryPoints: [join(options.root, config.runtime.entrypoint)],
      outfile: bundlePath,
      bundle: true,
      platform: "node",
      format: "esm",
      target: `node${config.runtime.node}`,
      sourcemap: false,
      legalComments: "external",
      logLevel: "silent",
      external: ["@curve-ai/sdk/development"],
    });

    const bundle = await readFile(bundlePath);
    const bundleSha256 = createHash("sha256").update(bundle).digest("hex");
    const manifest = createAgentManifest(config);
    const manifestJson = canonicalJson(manifest);
    const buildDigest = createHash("sha256")
      .update(manifestJson)
      .update(platform)
      .update(bundle)
      .digest("hex");
    const imageReference = `radius.local/dev/${safeImageName(config.name)}:${buildDigest.slice(0, 16)}`;

    // The template is computed before the image is built, because it has to be
    // embedded in that image's config as a label. Everything it needs —
    // buildDigest, reference, config — is known at this point.
    const template = synthesiseReleaseTemplate({
      config,
      buildDigest,
      imageReference,
      platform,
      processArguments: ["node", "/opt/agent/agent.mjs"],
      imageSizeMb: estimateImageMb(bundle.byteLength),
    });
    const labels = releaseTemplateLabels(template);

    await writeFile(
      join(contextPath, "Containerfile"),
      renderTypeScriptContainerfile(),
      "utf8",
    );
    await writeFile(join(contextPath, "manifest.json"), manifestJson, "utf8");

    const imageTarPath = join(temporaryRoot, "image.oci.tar");
    // Docker Desktop's default builder cannot export OCI, so load then docker save.
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
        ...Object.entries(labels).flatMap(([key, value]) => [
          "--label",
          `${key}=${value}`,
        ]),
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

    // The template claimed a rootfs size before the image existed. If the
    // built image is larger than claimed, the guest would not boot — so fail
    // here rather than ship a layout that cannot start.
    const claimedMb = estimateImageMb(bundle.byteLength);
    if (imageSizeMb > claimedMb) {
      throw new BuildError(
        `Built image is larger than the release template claims (${Math.ceil(imageSizeMb)}MB > ${claimedMb}MB). Raise BASE_IMAGE_COMPRESSED_BYTES in oci.ts.`,
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
      bundleSha256,
      releaseVersion: String(template.releaseVersion),
      indexPath: join(finalRoot, "index.json"),
    };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

/** Deterministic: pinned base plus the bundle, decompressed generously. */
export function estimateImageMb(bundleBytes: number): number {
  return Math.ceil(
    ((BASE_IMAGE_COMPRESSED_BYTES + bundleBytes) * 4) / (1024 * 1024),
  );
}

export function renderTypeScriptContainerfile(): string {
  return `FROM ${NODE_IMAGE}\n\nRUN groupadd --gid 10000 radius \\\n  && useradd --uid 10000 --gid 10000 --home-dir /opt/data --no-create-home radius \\\n  && mkdir -p /opt/agent /opt/data \\\n  && chown -R 10000:10000 /opt/agent /opt/data\n\nWORKDIR /opt/data\nCOPY --chown=10000:10000 agent.mjs /opt/agent/agent.mjs\nCOPY --chown=10000:10000 manifest.json /opt/agent/manifest.json\nUSER 10000:10000\nENV HOME=/opt/data\nENTRYPOINT ["node", "/opt/agent/agent.mjs"]\n`;
}

function safeImageName(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || basename(process.cwd()).toLowerCase();
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
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
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${command} failed with ${code}: ${stderr.trim()}`));
    });
  });
}
