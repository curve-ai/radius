import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentConfig, AgentRuntimeConfig } from "@curve-ai/agent-contracts";
import { acpStreamFromChild, connectAcpRuntime } from "@curve-ai/radius-runtime";

import { loadAgentConfig } from "./config.js";
import type { CliIo } from "./io.js";
import { startSandboxAgent } from "./sandbox.js";

export interface DevOptions {
  root: string;
  configPath?: string;
  prompt?: string;
  sandbox?: boolean;
  watch?: boolean;
  runtimeHostPath?: string;
  kernelPath?: string;
  runtimeRoot?: string;
  io: CliIo;
}

interface PromptRuntime {
  prompt(text: string): Promise<{ text: string; stopReason: string }>;
}

interface RunningDevelopmentAgent {
  name: string;
  runtime: PromptRuntime;
  stop(): Promise<void>;
}

export async function runDevelopmentAgent(options: DevOptions): Promise<void> {
  let running = await startDevelopmentAgent(options);
  if (options.prompt !== undefined) {
    try {
      await runPrompt(options.prompt, running.runtime, options.io);
    } finally {
      await running.stop();
    }
    return;
  }

  let changed = false;
  const watcher =
    options.watch === false
      ? null
      : watchProject(
          options.root,
          (path) => {
            if (changed) return;
            changed = true;
            options.io.out(
              `Change detected: ${path}. The agent will restart before the next prompt.`,
            );
          },
          options.io,
        );

  options.io.out(`Running ${running.name}. Enter a prompt or press Ctrl-D to exit.`);
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const prompt = await input.question("radius> ");
      if (!prompt.trim()) continue;
      if (changed) {
        options.io.out("Restarting the Radius development agent...");
        await running.stop();
        running = await startDevelopmentAgent(options);
        changed = false;
      }
      await runPrompt(prompt, running.runtime, options.io);
    }
  } catch {
    // EOF exits the local prompt loop.
  } finally {
    input.close();
    watcher?.close();
    await running.stop();
  }
}

async function startDevelopmentAgent(
  options: DevOptions,
): Promise<RunningDevelopmentAgent> {
  const { config } = await loadAgentConfig(options.root, options.configPath);
  if (options.sandbox) {
    const sandbox = await startSandboxAgent({
      root: options.root,
      config,
      runtimeHostPath: options.runtimeHostPath,
      kernelPath: options.kernelPath,
      runtimeRoot: options.runtimeRoot,
      io: options.io,
    });
    return {
      name: config.name,
      runtime: sandbox,
      stop: () => sandbox.stop(),
    };
  }
  return startNativeAgent(options.root, config);
}

async function startNativeAgent(
  root: string,
  config: AgentConfig,
): Promise<RunningDevelopmentAgent> {
  const child = startAgentProcess(root, config.runtime);
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  try {
    const runtime = await connectAcpRuntime(acpStreamFromChild(child), {
      cwd: root,
      clientName: "radius-cli-dev",
      handlers: {
        onPermissionRequest: async () => ({ outcome: "cancelled" }),
      },
    });
    return {
      name: config.name,
      runtime,
      stop: async () => {
        runtime.close();
        await stopChild(child);
      },
    };
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

function startAgentProcess(
  root: string,
  runtime: AgentRuntimeConfig,
): ChildProcessWithoutNullStreams {
  if (runtime.kind === "typescript") {
    const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
    return spawn(process.execPath, [tsxCli, join(root, runtime.entrypoint)], {
      cwd: root,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  if (runtime.kind === "python") {
    return spawn(
      "uv",
      [
        "run",
        "--locked",
        "--python",
        runtime.python,
        "python",
        "-m",
        runtime.module,
      ],
      { cwd: root, env: process.env, stdio: ["pipe", "pipe", "pipe"] },
    );
  }
  const [command, ...args] = runtime.command;
  return spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

async function runPrompt(
  prompt: string,
  runtime: PromptRuntime,
  io: CliIo,
): Promise<void> {
  const result = await runtime.prompt(prompt);
  io.out(result.text);
  if (result.stopReason !== "end_turn") {
    io.error(`Agent stopped: ${result.stopReason}`);
  }
}

function watchProject(
  root: string,
  onChange: (path: string) => void,
  io: CliIo,
): FSWatcher | null {
  try {
    return watch(root, { recursive: true }, (_event, filename) => {
      const path = filename?.toString() ?? "project";
      if (shouldIgnoreWatchPath(path)) return;
      onChange(path);
    });
  } catch (error) {
    io.error(
      `File watching unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export function shouldIgnoreWatchPath(path: string): boolean {
  return path
    .split(/[\\/]/)
    .some((segment) =>
      [".git", ".radius", "node_modules", "dist", "coverage"].includes(segment),
    );
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => child.kill("SIGKILL"), 3_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
