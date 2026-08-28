import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

import { acpStreamFromChild } from "./stdio.js";
import {
  connectAcpRuntime,
  type AcpRuntimeHandlers,
  type AcpRuntimeSession,
} from "./session.js";
import type { McpServer } from "@agentclientprotocol/sdk";
import {
  immutableImageReference,
  type AgentReleaseDescriptor,
} from "./release.js";

export interface MicrovmRuntimePaths {
  runtimeHostPath: string;
  kernelPath: string;
  runtimeRoot: string;
  developerStateSharePath?: string;
  developerStateShareUser?: string;
}

export interface StartMicrovmAcpOptions {
  release: AgentReleaseDescriptor;
  paths: MicrovmRuntimePaths;
  handlers: AcpRuntimeHandlers;
  cwd?: string;
  containerId?: string;
  modelId?: string | null;
  mcpServers?: McpServer[];
  onStderr?: (chunk: string) => void;
}

interface RuntimeProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

const MAX_RUNTIME_STDERR_BYTES = 8_192;

function appendRuntimeStderr(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length <= MAX_RUNTIME_STDERR_BYTES
    ? next
    : next.slice(next.length - MAX_RUNTIME_STDERR_BYTES);
}

function runtimeStderrDetail(stderr: string): string {
  const trimmed = stderr.trim();
  const finalLine = trimmed.split("\n").at(-1) ?? "";
  try {
    const envelope = JSON.parse(finalLine) as { message?: unknown };
    if (typeof envelope.message === "string" && envelope.message.trim()) {
      return envelope.message.trim().slice(-2_000);
    }
  } catch {
    // Runtime stderr is not required to use the host error envelope.
  }
  return trimmed.slice(-2_000);
}

export function runtimeProcessFailure(
  cause: unknown,
  exit: RuntimeProcessExit | null,
  stderr: string,
): Error {
  const detail = runtimeStderrDetail(stderr);
  if (!exit && !detail) {
    return cause instanceof Error ? cause : new Error("Agent runtime failed");
  }
  const outcome = exit
    ? exit.code !== null
      ? `Agent runtime exited with code ${exit.code}`
      : `Agent runtime exited after signal ${exit.signal ?? "unknown"}`
    : "Agent runtime connection closed";
  return new Error(detail ? `${outcome}: ${detail}` : outcome, {
    cause: cause instanceof Error ? cause : undefined,
  });
}

async function recentProcessExit(
  child: ChildProcessWithoutNullStreams,
  exitPromise: Promise<RuntimeProcessExit>,
): Promise<RuntimeProcessExit | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return Promise.race([
    exitPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 150)),
  ]);
}

export class MicrovmAcpRuntime {
  private constructor(
    readonly process: ChildProcessWithoutNullStreams,
    readonly session: AcpRuntimeSession,
    private readonly exitPromise: Promise<RuntimeProcessExit>,
    private readonly stderr: () => string,
  ) {}

  static async start(
    options: StartMicrovmAcpOptions,
  ): Promise<MicrovmAcpRuntime> {
    const args = microvmRuntimeArguments(options);
    const child = spawn(options.paths.runtimeHostPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    const exitPromise = new Promise<RuntimeProcessExit>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = appendRuntimeStderr(stderr, chunk);
      options.onStderr?.(chunk.slice(0, 8_192));
    });

    try {
      const session = await connectAcpRuntime(acpStreamFromChild(child), {
        cwd: options.cwd ?? options.release.process.statePath,
        handlers: options.handlers,
        clientName: "radius-desktop",
        mcpServers: options.mcpServers,
        modelId: options.modelId,
      });
      return new MicrovmAcpRuntime(child, session, exitPromise, () => stderr);
    } catch (error) {
      const exit = await recentProcessExit(child, exitPromise);
      if (exit === null) child.kill("SIGTERM");
      throw runtimeProcessFailure(error, exit, stderr);
    }
  }

  async prompt(text: string) {
    try {
      return await this.session.prompt(text);
    } catch (error) {
      throw runtimeProcessFailure(
        error,
        await recentProcessExit(this.process, this.exitPromise),
        this.stderr(),
      );
    }
  }

  async cancel(): Promise<void> {
    await this.session.cancel();
  }

  async stop(): Promise<void> {
    this.session.close();
    if (this.process.exitCode !== null || this.process.signalCode !== null)
      return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.process.kill("SIGKILL");
      }, 3_000);
      this.process.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      this.process.kill("SIGTERM");
    });
  }
}

export function microvmRuntimeArguments(
  options: Pick<StartMicrovmAcpOptions, "release" | "paths" | "containerId">,
): string[] {
  const { release, paths } = options;
  const args = [
    "run",
    "--image",
    immutableImageReference(release),
    "--kernel",
    paths.kernelPath,
    "--root",
    paths.runtimeRoot,
    "--container-id",
    options.containerId ?? `${release.agentId}-${randomUUID()}`,
    "--cpus",
    String(release.resources.cpus),
    "--memory-mb",
    String(release.resources.memoryMb),
    "--rootfs-mb",
    String(release.resources.rootfsMb),
    "--writable-mb",
    String(release.resources.stateMb),
    "--process-limit",
    String(release.resources.processLimit),
    "--open-file-limit",
    String(release.resources.openFileLimit),
    "--user",
    paths.developerStateShareUser ?? release.process.user,
  ];

  if (release.image.translation === "rosetta") args.push("--rosetta");
  if (paths.developerStateSharePath) {
    args.push("--developer-state-share", paths.developerStateSharePath);
  }
  args.push("--", ...release.process.arguments);
  return args;
}
