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

import { canonicalJson, createAgentManifest } from "./manifest.js";

const NODE_IMAGE =
  "node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5";

export interface TypeScriptOciBuildOptions {
  root: string;
  config: AgentConfigInput;
  outputRoot?: string;
  dockerExecutable?: string;
}

export interface TypeScriptOciBuildResult {
  buildDigest: string;
  imageReference: string;
  imageDigest: `sha256:${string}`;
  layoutPath: string;
  contextPath: string;
  manifest: AgentManifest;
  bundleSha256: string;
}

export async function buildTypeScriptOciLayout(
  options: TypeScriptOciBuildOptions,
): Promise<TypeScriptOciBuildResult> {
  const config = AgentConfigSchema.parse(options.config);
  if (config.runtime.kind !== "typescript") {
    throw new Error("TypeScript OCI build requires a TypeScript runtime config");
  }

  const outputRoot = options.outputRoot ?? join(options.root, ".radius", "builds");
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
    });

    const bundle = await readFile(bundlePath);
    const bundleSha256 = createHash("sha256").update(bundle).digest("hex");
    const manifest = createAgentManifest(config);
    const manifestJson = canonicalJson(manifest);
    const buildDigest = createHash("sha256")
      .update(manifestJson)
      .update(bundle)
      .digest("hex");
    const imageReference = `radius.local/dev/${safeImageName(config.name)}:${buildDigest.slice(0, 16)}`;

    await writeFile(
      join(contextPath, "Containerfile"),
      renderTypeScriptContainerfile(),
      "utf8",
    );
    await writeFile(join(contextPath, "manifest.json"), manifestJson, "utf8");

    const imageTarPath = join(temporaryRoot, "image.oci.tar");
    await runCommand(
      options.dockerExecutable ?? "docker",
      [
        "buildx",
        "build",
        "--platform",
        "linux/arm64",
        "--provenance=false",
        "--sbom=false",
        "--build-arg",
        "SOURCE_DATE_EPOCH=0",
        "--tag",
        imageReference,
        "--output",
        `type=oci,dest=${imageTarPath}`,
        "--file",
        join(contextPath, "Containerfile"),
        contextPath,
      ],
      options.root,
    );

    const layoutPath = join(temporaryRoot, "oci-layout");
    await mkdir(layoutPath, { recursive: true });
    await runCommand("tar", ["-xf", imageTarPath, "-C", layoutPath], options.root);
    await rm(imageTarPath, { force: true });

    const index = JSON.parse(await readFile(join(layoutPath, "index.json"), "utf8")) as {
      manifests?: Array<{ digest?: string }>;
    };
    const imageDigest = index.manifests?.[0]?.digest;
    if (!imageDigest || !/^sha256:[a-f0-9]{64}$/.test(imageDigest)) {
      throw new Error("OCI build did not produce a digest-pinned manifest");
    }

    const finalRoot = join(outputRoot, buildDigest);
    await rm(finalRoot, { recursive: true, force: true });
    await rename(temporaryRoot, finalRoot);
    return {
      buildDigest,
      imageReference,
      imageDigest: imageDigest as `sha256:${string}`,
      layoutPath: join(finalRoot, "oci-layout"),
      contextPath: join(finalRoot, "context"),
      manifest,
      bundleSha256,
    };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
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
      else reject(new Error(`${command} failed with ${code}: ${stderr.trim()}`));
    });
  });
}
