import type { Writable } from "node:stream";
import type { CommandContext } from "@stricli/core";

export type OutputMode = "text" | "json";

/**
 * The typed context ADR-008 decided on, threaded into every handler by Stricli.
 *
 * Everything a command needs from the outside world arrives here — including
 * the platform, the pid and the termination signal — so no handler reaches for
 * the global `process`, and a test constructs a context instead of patching
 * globals.
 */
export interface RadiusContext extends CommandContext {
  readonly process: {
    readonly stdout: Writable;
    readonly stderr: Writable;
    exitCode?: number;
    readonly env?: Readonly<Partial<Record<string, string>>>;
    readonly platform: NodeJS.Platform;
    readonly arch: string;
    readonly pid: number;
  };
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly isTTY: boolean;
  readonly colour: boolean;
  readonly output: OutputMode;
  /** Prints only in text mode, so --json output is never polluted. */
  out(message: string): void;
  /** Always prints to stderr, in both modes. */
  note(message: string): void;
  /** Resolves when the command should wind down. */
  untilStopped(): Promise<void>;
  /** Asks a long-running command to wind down. */
  stop(): void;
  /**
   * Records the exit code a failed command should produce.
   *
   * Stricli assigns `process.exitCode` itself once the handler returns, so a
   * handler that sets it directly is overwritten. The entry point applies this
   * after `run()` instead.
   */
  fail(code: number): void;
  /** The recorded failure code, if any. */
  readonly failure: () => number | null;
}

export function buildContext(
  argv: readonly string[],
  base: NodeJS.Process = process,
): RadiusContext {
  const output: OutputMode = argv.includes("--json") ? "json" : "text";
  const isTTY = Boolean(base.stdout.isTTY);
  const colour = isTTY && !base.env.NO_COLOR;

  let release: (() => void) | null = null;
  const stopped = new Promise<void>((settle) => {
    release = settle;
  });
  const stop = (): void => release?.();
  base.once("SIGINT", stop);
  base.once("SIGTERM", stop);

  // Adapted rather than passed through: Node types `exitCode` as
  // `string | number | null | undefined`, Stricli wants `number | undefined`,
  // and handlers should only ever set a number.
  const adapted = {
    stdout: base.stdout,
    stderr: base.stderr,
    env: base.env,
    platform: base.platform,
    arch: base.arch,
    pid: base.pid,
    get exitCode(): number | undefined {
      return typeof base.exitCode === "number" ? base.exitCode : undefined;
    },
    set exitCode(value: number | undefined) {
      base.exitCode = value;
    },
  };

  let failed: number | null = null;

  return {
    process: adapted,
    cwd: base.cwd(),
    env: base.env,
    isTTY,
    colour,
    output,
    out(message) {
      if (output === "text") base.stdout.write(`${message}\n`);
    },
    note(message) {
      base.stderr.write(`${message}\n`);
    },
    untilStopped: () => stopped,
    stop,
    fail(code) {
      failed = code;
    },
    failure: () => failed,
  };
}

/**
 * The `--json` envelope. ADR-008 makes this a versioned public contract, which
 * means it needs a failure shape too — a contract that only describes success
 * forces every consumer to parse prose off stderr.
 */
export const JSON_ENVELOPE_VERSION = 1;

export function emitJson(context: RadiusContext, data: unknown): void {
  context.process.stdout.write(
    `${JSON.stringify({ schemaVersion: JSON_ENVELOPE_VERSION, ok: true, data }, null, 2)}\n`,
  );
}

export function emitJsonError(
  context: RadiusContext,
  error: { code: string; message: string; nextAction?: string },
): void {
  context.process.stdout.write(
    `${JSON.stringify({ schemaVersion: JSON_ENVELOPE_VERSION, ok: false, error }, null, 2)}\n`,
  );
}
