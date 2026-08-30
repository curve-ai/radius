import { access, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  AgentBuildReceiptSchema,
  type AgentBuildReceipt,
  type AgentConfig,
} from "@curve-ai/agent-contracts";
import {
  buildPythonOciLayout,
  buildTypeScriptOciLayout,
  canonicalJson,
  type PythonOciBuildResult,
  type TypeScriptOciBuildResult,
} from "@curve-ai/build";

import { loadAgentConfig } from "./config.js";
import type { CliIo } from "./io.js";
import { startBuiltSandboxAgent, type AgentOciBuildResult } from "./sandbox.js";

type AgentOciBuilder = (options: {
  root: string;
  config: AgentConfig;
}) => Promise<TypeScriptOciBuildResult | PythonOciBuildResult>;

export interface BuildOptions {
  root: string;
  configPath?: string;
  runtimeHostPath?: string;
  kernelPath?: string;
  runtimeRoot?: string;
  buildOci?: AgentOciBuilder;
  verifyBuild?: (options: {
    root: string;
    config: AgentConfig;
    build: AgentOciBuildResult;
  }) => Promise<void>;
  io: CliIo;
}

export async function buildAgent(
  options: BuildOptions,
): Promise<AgentBuildReceipt> {
  const { config } = await loadAgentConfig(options.root, options.configPath);
  if (config.runtime.kind === "command") {
    throw new Error(
      "radius build requires a TypeScript or Python build runtime",
    );
  }
  const defaultBuilder =
    config.runtime.kind === "python"
      ? buildPythonOciLayout
      : buildTypeScriptOciLayout;
  options.io.out("Building the immutable Radius agent image...");
  const build = await (options.buildOci ?? defaultBuilder)({
    root: options.root,
    config,
  });
  options.io.out(`Built ${build.imageReference}@${build.imageDigest}`);
  options.io.out("Verifying ACP inside the Radius microVM...");
  if (options.verifyBuild) {
    await options.verifyBuild({ root: options.root, config, build });
  } else {
    const runtime = await startBuiltSandboxAgent({
      root: options.root,
      config,
      build,
      runtimeHostPath: options.runtimeHostPath,
      kernelPath: options.kernelPath,
      runtimeRoot: options.runtimeRoot,
      io: options.io,
    });
    await runtime.stop();
  }

  const receipt = AgentBuildReceiptSchema.parse({
    schemaVersion: 1,
    buildDigest: build.buildDigest,
    imageReference: build.imageReference,
    sourceManifestDigest: build.imageDigest,
    bundleSha256: build.bundleSha256,
    layoutPath: projectRelativePath(options.root, build.layoutPath),
    contextPath: projectRelativePath(options.root, build.contextPath),
    manifest: build.manifest,
    verifiedAt: new Date().toISOString(),
    verification: { kind: "microvm-acp", platform: "linux/arm64" },
  });
  const receiptPath = join(
    options.root,
    ".radius",
    "builds",
    receipt.buildDigest,
    "receipt.json",
  );
  await writeFile(receiptPath, canonicalJson(receipt), {
    encoding: "utf8",
    mode: 0o600,
  });
  await writeFile(
    join(options.root, ".radius", "builds", "latest.json"),
    canonicalJson({ schemaVersion: 1, buildDigest: receipt.buildDigest }),
    { encoding: "utf8", mode: 0o600 },
  );
  options.io.out(`Build receipt: ${receiptPath}`);
  options.io.out(`Build digest: ${receipt.buildDigest}`);
  return receipt;
}

export async function loadBuildReceipt(
  root: string,
  reference?: string,
): Promise<{
  receipt: AgentBuildReceipt;
  build: AgentOciBuildResult;
  path: string;
}> {
  const receiptPath = await resolveReceiptPath(root, reference);
  const receipt = AgentBuildReceiptSchema.parse(
    JSON.parse(await readFile(receiptPath, "utf8")),
  );
  const layoutPath = resolve(root, receipt.layoutPath);
  const contextPath = resolve(root, receipt.contextPath);
  await Promise.all([access(layoutPath), access(contextPath)]);
  return {
    receipt,
    path: receiptPath,
    build: {
      buildDigest: receipt.buildDigest,
      imageReference: receipt.imageReference,
      imageDigest: receipt.sourceManifestDigest as `sha256:${string}`,
      layoutPath,
      contextPath,
      manifest: receipt.manifest,
      bundleSha256: receipt.bundleSha256,
    },
  };
}

async function resolveReceiptPath(
  root: string,
  reference?: string,
): Promise<string> {
  if (reference) {
    if (/^[a-f0-9]{64}$/.test(reference)) {
      return join(root, ".radius", "builds", reference, "receipt.json");
    }
    return isAbsolute(reference) ? reference : resolve(root, reference);
  }
  const latest = JSON.parse(
    await readFile(join(root, ".radius", "builds", "latest.json"), "utf8"),
  ) as { buildDigest?: unknown };
  if (
    typeof latest.buildDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(latest.buildDigest)
  ) {
    throw new Error("Latest Radius build pointer is invalid");
  }
  return join(root, ".radius", "builds", latest.buildDigest, "receipt.json");
}

function projectRelativePath(root: string, target: string): string {
  const path = relative(resolve(root), resolve(target)).replaceAll("\\", "/");
  if (!path || path.startsWith("../") || path === "..") {
    throw new Error(
      "Radius build output must remain inside the agent repository",
    );
  }
  return path;
}
