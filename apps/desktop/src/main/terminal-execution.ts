import type {
  AcpTerminalHandlers,
  CreateTerminalRequest,
} from "@curve-ai/radius-runtime";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";

import { createSeatbeltCommand } from "./seatbelt-policy";

const DEFAULT_OUTPUT_LIMIT_BYTES = 256 * 1024;
const MAX_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const MAX_COMMAND_BYTES = 16 * 1024;
const MAX_ARGUMENTS = 256;
const MAX_ARGUMENT_BYTES = 64 * 1024;
const TERMINATE_GRACE_MS = 1_000;

const inheritedEnvironmentKeys = new Set([
  "HOME",
  "LANG",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TMPDIR",
  "USER",
]);
const requestedEnvironmentKeys = new Set([
  "CI",
  "LANG",
  "NO_COLOR",
  "PAGER",
  "PYTHONUNBUFFERED",
  "RUST_BACKTRACE",
  "TERM",
]);

export interface TerminalAuthorizationRequest {
  command: string;
  args: string[];
  cwd: string;
  environment: Array<{ name: string; value: string }>;
  outsideProjectRoots: boolean;
}

export interface TerminalExecutionResult {
  correlationId: string;
  durationMs: number;
  exitCode: number | null;
  output: string;
  outputTruncated: boolean;
  signal: string | null;
}

export interface TerminalExecutionProgress {
  correlationId: string;
  exitCode: number | null;
  output: string;
  outputTruncated: boolean;
  signal: string | null;
}

export interface MacOsTerminalManagerOptions {
  fullAccess?: boolean;
  projectRoots: readonly string[];
  authorize(
    request: TerminalAuthorizationRequest,
    signal: AbortSignal,
  ): Promise<string>;
  onProgress?(result: TerminalExecutionProgress): Promise<void> | void;
  onResult(result: TerminalExecutionResult): Promise<void> | void;
}

interface ManagedTerminal {
  child: ChildProcessByStdio<null, Readable, Readable>;
  correlationId: string;
  exit: Promise<{ exitCode: number | null; signal: string | null }>;
  exitStatus: { exitCode: number | null; signal: string | null } | null;
  output: string;
  outputLimitBytes: number;
  outputTruncated: boolean;
  lastReportedOutput: string | null;
  lastReportedStatus: string | null;
  startedAtMs: number;
  resultRecorded: boolean;
  temporaryRoot: string;
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function canonicalDirectory(target: string): Promise<string> {
  if (!path.isAbsolute(target)) {
    throw new Error("ACP terminal working directories must be absolute");
  }
  const canonical = await realpath(target);
  if (!(await stat(canonical)).isDirectory()) {
    throw new Error("ACP terminal working directory must be a folder");
  }
  return canonical;
}

function validateCommand(request: CreateTerminalRequest): void {
  if (!request.command.trim())
    throw new Error("ACP terminal command is required");
  if (Buffer.byteLength(request.command) > MAX_COMMAND_BYTES) {
    throw new Error("ACP terminal command is too long");
  }
  const args = request.args ?? [];
  if (args.length > MAX_ARGUMENTS) {
    throw new Error("ACP terminal has too many arguments");
  }
  if (Buffer.byteLength(args.join("\0")) > MAX_ARGUMENT_BYTES) {
    throw new Error("ACP terminal arguments are too large");
  }
}

function requestedEnvironment(
  request: CreateTerminalRequest,
): Array<{ name: string; value: string }> {
  return (request.env ?? []).map((entry) => {
    if (!requestedEnvironmentKeys.has(entry.name)) {
      throw new Error(
        `ACP terminal environment variable is not allowed: ${entry.name}`,
      );
    }
    if (entry.value.includes("\0") || Buffer.byteLength(entry.value) > 4_096) {
      throw new Error(
        `ACP terminal environment variable is invalid: ${entry.name}`,
      );
    }
    return { name: entry.name, value: entry.value };
  });
}

function commandEnvironment(
  requested: readonly { name: string; value: string }[],
  temporaryRoot: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  };
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && inheritedEnvironmentKeys.has(name)) {
      environment[name] = value;
    }
    if (value !== undefined && name.startsWith("LC_")) {
      environment[name] = value;
    }
  }
  for (const entry of requested) environment[entry.name] = entry.value;
  environment.TMPDIR = temporaryRoot;
  return environment;
}

function utf8Tail(value: string, byteLimit: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= byteLimit) return value;
  const start = buffer.length - byteLimit;
  for (
    let offset = start;
    offset < Math.min(buffer.length, start + 4);
    offset += 1
  ) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        buffer.subarray(offset),
      );
    } catch {
      // Advance to the next UTF-8 character boundary.
    }
  }
  return buffer.subarray(start).toString("utf8");
}

function appendOutput(terminal: ManagedTerminal, chunk: string): void {
  const next = terminal.output + chunk;
  if (Buffer.byteLength(next) > terminal.outputLimitBytes) {
    terminal.outputTruncated = true;
    terminal.output = utf8Tail(next, terminal.outputLimitBytes);
  } else {
    terminal.output = next;
  }
}

function abortError(): Error {
  const error = new Error("ACP terminal request was cancelled");
  error.name = "AbortError";
  return error;
}

function waitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export class MacOsTerminalManager implements AcpTerminalHandlers {
  readonly #projectRoots: string[];
  readonly #terminals = new Map<string, ManagedTerminal>();
  #sessionId: string | null = null;

  constructor(private readonly options: MacOsTerminalManagerOptions) {
    this.#projectRoots = [...new Set(options.projectRoots)];
  }

  bindSession(sessionId: string): void {
    if (this.#sessionId && this.#sessionId !== sessionId) {
      throw new Error(
        "ACP terminal manager is already bound to another session",
      );
    }
    this.#sessionId = sessionId;
  }

  async create(
    request: CreateTerminalRequest,
    signal: AbortSignal,
  ): Promise<{ terminalId: string }> {
    this.#assertSession(request.sessionId);
    if (process.platform !== "darwin") {
      throw new Error("ACP host terminals currently require macOS");
    }
    validateCommand(request);
    if (signal.aborted) throw abortError();
    const primaryRoot = this.#projectRoots[0];
    if (!primaryRoot)
      throw new Error(
        "A project source folder is required for terminal access",
      );
    const cwd = await canonicalDirectory(request.cwd ?? primaryRoot);
    const environment = requestedEnvironment(request);
    const outsideProjectRoots = !this.#projectRoots.some((root) =>
      isWithinRoot(root, cwd),
    );
    const correlationId = await this.options.authorize(
      {
        command: request.command,
        args: [...(request.args ?? [])],
        cwd,
        environment,
        outsideProjectRoots,
      },
      signal,
    );
    if (signal.aborted) throw abortError();

    const temporaryRoot = await realpath(
      await mkdtemp(path.join(tmpdir(), "radius-terminal-")),
    );
    const sandboxRoots = outsideProjectRoots
      ? [...this.#projectRoots, cwd, temporaryRoot]
      : [...this.#projectRoots, temporaryRoot];

    const command = this.options.fullAccess
      ? { program: request.command, args: request.args ?? [] }
      : createSeatbeltCommand({
          command: request.command,
          args: request.args ?? [],
          cwd,
          readableRoots: sandboxRoots,
          writableRoots: sandboxRoots,
        });
    const child = spawn(command.program, command.args, {
      cwd,
      detached: true,
      env: commandEnvironment(environment, temporaryRoot),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const terminalId = randomUUID();
    const terminal: ManagedTerminal = {
      child,
      correlationId,
      exit: Promise.resolve({ exitCode: null, signal: null }),
      exitStatus: null,
      output: "",
      outputLimitBytes: Math.min(
        Number(request.outputByteLimit ?? DEFAULT_OUTPUT_LIMIT_BYTES),
        MAX_OUTPUT_LIMIT_BYTES,
      ),
      outputTruncated: false,
      lastReportedOutput: null,
      lastReportedStatus: null,
      startedAtMs: Date.now(),
      resultRecorded: false,
      temporaryRoot,
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => appendOutput(terminal, chunk));
    child.stderr.on("data", (chunk: string) => appendOutput(terminal, chunk));
    terminal.exit = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, processSignal) => {
        const status = { exitCode, signal: processSignal };
        terminal.exitStatus = status;
        resolve(status);
      });
    });
    this.#terminals.set(terminalId, terminal);
    return { terminalId };
  }

  async output(request: { sessionId: string; terminalId: string }): Promise<{
    output: string;
    truncated: boolean;
    exitStatus: { exitCode: number | null; signal: string | null } | null;
  }> {
    this.#assertSession(request.sessionId);
    const terminal = this.#requireTerminal(request.terminalId);
    await this.#reportProgress(terminal);
    await this.#recordResult(terminal);
    return {
      output: terminal.output,
      truncated: terminal.outputTruncated,
      exitStatus: terminal.exitStatus,
    };
  }

  async waitForExit(
    request: { sessionId: string; terminalId: string },
    signal: AbortSignal,
  ): Promise<{ exitCode: number | null; signal: string | null }> {
    this.#assertSession(request.sessionId);
    const status = await waitWithSignal(
      this.#requireTerminal(request.terminalId).exit,
      signal,
    );
    const terminal = this.#requireTerminal(request.terminalId);
    await this.#reportProgress(terminal);
    await this.#recordResult(terminal);
    return status;
  }

  async kill(request: {
    sessionId: string;
    terminalId: string;
  }): Promise<void> {
    this.#assertSession(request.sessionId);
    this.#terminate(this.#requireTerminal(request.terminalId));
  }

  async release(request: {
    sessionId: string;
    terminalId: string;
  }): Promise<void> {
    this.#assertSession(request.sessionId);
    const terminal = this.#requireTerminal(request.terminalId);
    if (!terminal.exitStatus) this.#terminate(terminal);
    await terminal.exit.catch(() => undefined);
    await this.#recordResult(terminal);
    this.#terminals.delete(request.terminalId);
  }

  async close(): Promise<void> {
    const terminals = [...this.#terminals.values()];
    for (const terminal of terminals) this.#terminate(terminal);
    await Promise.all(
      terminals.map((terminal) => terminal.exit.catch(() => undefined)),
    );
    for (const terminal of terminals) await this.#recordResult(terminal);
    this.#terminals.clear();
  }

  #assertSession(sessionId: string): void {
    if (!this.#sessionId) {
      this.#sessionId = sessionId;
      return;
    }
    if (sessionId !== this.#sessionId) {
      throw new Error("ACP terminal does not belong to this session");
    }
  }

  #requireTerminal(terminalId: string): ManagedTerminal {
    const terminal = this.#terminals.get(terminalId);
    if (!terminal) throw new Error("ACP terminal is unavailable");
    return terminal;
  }

  #terminate(terminal: ManagedTerminal): void {
    if (terminal.exitStatus || terminal.child.pid === undefined) return;
    try {
      process.kill(-terminal.child.pid, "SIGTERM");
    } catch {
      terminal.child.kill("SIGTERM");
    }
    setTimeout(() => {
      if (terminal.exitStatus || terminal.child.pid === undefined) return;
      try {
        process.kill(-terminal.child.pid, "SIGKILL");
      } catch {
        terminal.child.kill("SIGKILL");
      }
    }, TERMINATE_GRACE_MS).unref();
  }

  async #recordResult(terminal: ManagedTerminal): Promise<void> {
    if (terminal.resultRecorded || !terminal.exitStatus) return;
    terminal.resultRecorded = true;
    try {
      await this.options.onResult({
        correlationId: terminal.correlationId,
        durationMs: Date.now() - terminal.startedAtMs,
        exitCode: terminal.exitStatus.exitCode,
        output: terminal.output,
        outputTruncated: terminal.outputTruncated,
        signal: terminal.exitStatus.signal,
      });
    } finally {
      await rm(terminal.temporaryRoot, { force: true, recursive: true });
    }
  }

  async #reportProgress(terminal: ManagedTerminal): Promise<void> {
    if (!this.options.onProgress) return;
    const status = terminal.exitStatus
      ? `${terminal.exitStatus.exitCode ?? ""}:${terminal.exitStatus.signal ?? ""}`
      : "running";
    if (
      terminal.lastReportedOutput === terminal.output &&
      terminal.lastReportedStatus === status
    ) {
      return;
    }
    terminal.lastReportedOutput = terminal.output;
    terminal.lastReportedStatus = status;
    await this.options.onProgress({
      correlationId: terminal.correlationId,
      exitCode: terminal.exitStatus?.exitCode ?? null,
      output: terminal.output,
      outputTruncated: terminal.outputTruncated,
      signal: terminal.exitStatus?.signal ?? null,
    });
  }
}
