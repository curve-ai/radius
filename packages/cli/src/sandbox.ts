import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse } from "node:path";

import {
  buildPythonOciLayout,
  buildTypeScriptOciLayout,
} from "@curve-ai/build";
import {
  MicrovmAcpRuntime,
  parseAgentReleaseDescriptor,
} from "@curve-ai/radius-runtime";
import type { AgentConfig } from "@curve-ai/agent-contracts";
import type {
  PythonOciBuildResult,
  TypeScriptOciBuildResult,
} from "@curve-ai/build";

import type { CliIo } from "./io.js";

export interface SandboxOptions {
  root: string;
  config: AgentConfig;
  runtimeHostPath?: string;
  kernelPath?: string;
  runtimeRoot?: string;
  io: CliIo;
}

export type AgentOciBuildResult =
  | PythonOciBuildResult
  | TypeScriptOciBuildResult;

export interface BuiltSandboxOptions extends SandboxOptions {
  build: AgentOciBuildResult;
}

export async function startSandboxAgent(
  options: SandboxOptions,
): Promise<MicrovmAcpRuntime> {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error(
      "Radius sandbox development currently requires Apple Silicon macOS",
    );
  }
  if (options.config.runtime.kind === "command") {
    throw new Error(
      "Sandbox development requires a TypeScript or Python build runtime",
    );
  }

  const build = await (
    options.config.runtime.kind === "python"
      ? buildPythonOciLayout
      : buildTypeScriptOciLayout
  )({
    root: options.root,
    config: options.config,
  });
  return startBuiltSandboxAgent({ ...options, build });
}

export async function startBuiltSandboxAgent(
  options: BuiltSandboxOptions,
): Promise<MicrovmAcpRuntime> {
  const defaults = await resolveDefaultRuntimeAssets(options.root);
  const runtimeHostPath =
    options.runtimeHostPath ??
    process.env.RADIUS_RUNTIME_HOST_PATH ??
    defaults.runtimeHostPath;
  const kernelPath =
    options.kernelPath ?? process.env.RADIUS_KERNEL_PATH ?? defaults.kernelPath;
  const runtimeRoot =
    options.runtimeRoot ??
    process.env.RADIUS_RUNTIME_ROOT ??
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
  options.io.out(
    `Imported ${options.build.imageReference}@${loadedDigest} (source manifest ${options.build.imageDigest})`,
  );

  const release = parseAgentReleaseDescriptor({
    schemaVersion: 1,
    agentId: `build-${options.build.buildDigest.slice(0, 16)}`,
    providerId: "radius-cli-build",
    displayName: options.config.name,
    releaseVersion: options.build.buildDigest.slice(0, 16),
    protocol: { kind: "acp-stdio", version: 1 },
    image: {
      reference: options.build.imageReference,
      digest: loadedDigest,
      platform: "linux/arm64",
      translation: "none",
    },
    process: {
      arguments:
        options.config.runtime.kind === "python"
          ? ["python", "-m", options.config.runtime.module]
          : ["node", "/opt/agent/agent.mjs"],
      user: "10000:10000",
      statePath: "/opt/data",
    },
    resources: {
      cpus: options.config.resources.cpu,
      memoryMb: options.config.resources.memoryMb,
      rootfsMb: 2048,
      stateMb: options.config.resources.diskMb,
      processLimit: 256,
      openFileLimit: 1024,
    },
    networkAllowlist: options.config.networkAllowlist,
    capabilities: options.config.capabilities.flatMap((capability) =>
      capability.operations.map(
        (operation) => `${capability.key}.${operation}`,
      ),
    ),
  });

  options.io.out("Starting Radius microVM sandbox...");
  return MicrovmAcpRuntime.start({
    release,
    paths: { runtimeHostPath, kernelPath, runtimeRoot },
    cwd: "/opt/data",
    handlers: {
      onPermissionRequest: async () => ({ outcome: "cancelled" }),
    },
    onStderr: (chunk) => options.io.error(chunk.trimEnd()),
  });
}

async function loadImage(options: {
  runtimeHostPath: string;
  layoutPath: string;
  runtimeRoot: string;
  imageReference: string;
}): Promise<`sha256:${string}`> {
  const output = await captureCommand(options.runtimeHostPath, [
    "load-image",
    "--layout",
    options.layoutPath,
    "--root",
    options.runtimeRoot,
  ]);
  const report = JSON.parse(output) as {
    type?: string;
    protocolVersion?: number;
    images?: Array<{ reference?: string; digest?: string }>;
  };
  if (
    report.type !== "radius.runtime.images-loaded" ||
    report.protocolVersion !== 1 ||
    !Array.isArray(report.images)
  ) {
    throw new Error("Runtime helper returned an invalid image-load report");
  }
  const image = report.images.find(
    (candidate) => candidate.reference === options.imageReference,
  );
  if (!image?.digest || !/^sha256:[a-f0-9]{64}$/.test(image.digest)) {
    throw new Error(`Runtime helper did not import ${options.imageReference}`);
  }
  return image.digest as `sha256:${string}`;
}

async function captureCommand(
  command: string,
  args: string[],
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-65_536);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-65_536);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else
        reject(new Error(`${command} failed with ${code}: ${stderr.trim()}`));
    });
  });
}

async function resolveDefaultRuntimeAssets(start: string): Promise<{
  runtimeHostPath: string;
  kernelPath: string;
}> {
  let current = start;
  const filesystemRoot = parse(current).root;
  for (;;) {
    const marker = join(
      current,
      "apps/runtime-host-macos/Config/runtime-assets.json",
    );
    try {
      await access(marker);
      return {
        runtimeHostPath: join(
          current,
          "apps/runtime-host-macos/.build/release/radius-runtime-host",
        ),
        kernelPath: join(
          current,
          "apps/runtime-host-macos/.build/runtime-assets/vmlinux-arm64",
        ),
      };
    } catch {
      if (current === filesystemRoot) break;
      current = dirname(current);
    }
  }
  if (process.platform === "darwin") {
    for (const application of [
      "/Applications/Radius.app",
      join(homedir(), "Applications/Radius.app"),
    ]) {
      const resources = join(application, "Contents/Resources");
      try {
        await access(join(resources, "runtime/vmlinux-arm64"));
        return {
          runtimeHostPath: join(
            resources,
            "runtime/macos-arm64/radius-runtime-host",
          ),
          kernelPath: join(resources, "runtime/vmlinux-arm64"),
        };
      } catch {
        // Continue to the next installed application location.
      }
    }
  }
  throw new Error(
    "Could not locate Radius runtime assets. Set RADIUS_RUNTIME_HOST_PATH and RADIUS_KERNEL_PATH.",
  );
}

async function requirePath(path: string, label: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(`Radius ${label} is missing: ${path}`);
  }
}
