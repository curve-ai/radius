import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/**
 * Runs an ACP agent just long enough to see what it is: `initialize`, then
 * `session/new`, then kill.
 *
 * Kept self-contained rather than built on the bridge, because a probe has the
 * opposite job. The bridge forgives a harness — it drops a stray stdout line so
 * a session survives it — while the probe exists to notice exactly that, and to
 * report every way the process misbehaved as data instead of as a throw.
 *
 * Stops before `session/prompt` for the same reason `verifyBuild` does: a
 * prompt needs a provider credential, and checking a project must not.
 */

export const PROBE_PROTOCOL_VERSION = 1;

export type ProbeStage = "spawn" | "initialize" | "session/new" | "done";

export interface ProbeOptions {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  /** Every frame in both directions, for `--verbose`. */
  readonly onFrame?: (
    direction: "client" | "agent",
    message: Record<string, unknown>,
  ) => void;
  /** Resolves when the caller wants the probe abandoned, e.g. on Ctrl-C. */
  readonly abort?: Promise<void>;
}

export type ProbeFailure =
  | { readonly kind: "spawn"; readonly message: string }
  | { readonly kind: "timeout"; readonly afterMs: number }
  | {
      readonly kind: "exit";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }
  | {
      readonly kind: "rpc";
      readonly code: number | null;
      readonly message: string;
    }
  | { readonly kind: "aborted" };

export interface ProbeResult {
  /** The step the probe was waiting on when it stopped; `done` on success. */
  readonly stage: ProbeStage;
  readonly failure: ProbeFailure | null;
  readonly initialize: Record<string, unknown> | null;
  readonly session: Record<string, unknown> | null;
  /**
   * Lines the agent wrote to stdout that were not a JSON-RPC message.
   *
   * The headline evidence for a whole class of breakage: stdout is the
   * protocol channel, and a client stricter than the bridge fails the session
   * on the first line it cannot parse.
   */
  readonly stdoutNoise: readonly string[];
  readonly stderrTail: string;
  readonly elapsedMs: number;
}

const STDERR_TAIL_BYTES = 4096;
const NOISE_LINES_KEPT = 20;
const KILL_GRACE_MS = 2000;

/** Mirrors the bridge's filter: a probed harness is third-party code too. */
function probeEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const carried: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith("RADIUS_")) continue;
    carried[key] = value;
  }
  return carried;
}

export async function probeAcp(options: ProbeOptions): Promise<ProbeResult> {
  const started = Date.now();
  const [executable, ...args] = options.command;
  const posix = process.platform !== "win32";

  let stage: ProbeStage = "spawn";
  let initialize: Record<string, unknown> | null = null;
  let session: Record<string, unknown> | null = null;
  const stdoutNoise: string[] = [];
  let noiseCount = 0;
  let stderrTail = "";

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(executable as string, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: probeEnvironment(options.env),
      // Its own process group on POSIX, so the kill reaches what `npx` or a
      // shell wrapper forked as well as the wrapper itself.
      detached: posix,
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
  } catch (error) {
    return {
      stage,
      failure: { kind: "spawn", message: (error as Error).message },
      initialize,
      session,
      stdoutNoise,
      stderrTail,
      elapsedMs: Date.now() - started,
    };
  }

  const closed = new Promise<void>((done) => child.once("close", () => done()));

  const failure = await new Promise<ProbeFailure | null>((settle) => {
    let settled = false;
    const finish = (outcome: ProbeFailure | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle(outcome);
    };
    const timer = setTimeout(
      () => finish({ kind: "timeout", afterMs: options.timeoutMs }),
      options.timeoutMs,
    );
    void options.abort?.then(() => finish({ kind: "aborted" }));

    const send = (message: Record<string, unknown>): void => {
      options.onFrame?.("client", message);
      if (child.stdin.writable)
        child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    child.once("error", (error) =>
      finish({ kind: "spawn", message: error.message }),
    );
    child.once("exit", (code, signal) =>
      finish({ kind: "exit", code, signal }),
    );
    // An agent that exits mid-write makes the next write EPIPE; the exit
    // already explains it, so the write error must not escape as a crash.
    child.stdin.on("error", () => {});
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(
        -STDERR_TAIL_BYTES,
      );
    });

    child.stdout.on(
      "data",
      lines((line) => {
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          message = undefined;
        }
        // Valid JSON is not enough: `42` or a bare string parses, and is just
        // as fatal to a JSON-RPC reader as prose.
        if (
          !message ||
          typeof message !== "object" ||
          Array.isArray(message) ||
          (message as { jsonrpc?: unknown }).jsonrpc !== "2.0"
        ) {
          noiseCount += 1;
          if (stdoutNoise.length < NOISE_LINES_KEPT) stdoutNoise.push(line);
          return;
        }
        const frame = message as Record<string, unknown>;
        options.onFrame?.("agent", frame);

        // A request from the agent — permission, fs, terminal — is refused
        // rather than ignored, so an agent that waits on the answer cannot
        // turn a refusal into a timeout.
        if (typeof frame.method === "string") {
          if (frame.id !== undefined) {
            send({
              jsonrpc: "2.0",
              id: frame.id,
              error: { code: -32601, message: "Not supported by radius check" },
            });
          }
          return;
        }

        const error = frame.error as
          { code?: unknown; message?: unknown } | undefined;
        if (error) {
          finish({
            kind: "rpc",
            code: typeof error.code === "number" ? error.code : null,
            message:
              typeof error.message === "string"
                ? error.message
                : JSON.stringify(error),
          });
          return;
        }
        const result =
          frame.result && typeof frame.result === "object"
            ? (frame.result as Record<string, unknown>)
            : {};
        if (frame.id === 1 && stage === "initialize") {
          initialize = result;
          stage = "session/new";
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "session/new",
            params: { cwd: options.cwd, mcpServers: [] },
          });
        } else if (frame.id === 2 && stage === "session/new") {
          session = result;
          stage = "done";
          finish(null);
        }
      }),
    );

    child.once("spawn", () => {
      stage = "initialize";
      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: PROBE_PROTOCOL_VERSION,
          // Advertises nothing, so a conforming agent never asks for a file
          // read or a terminal the probe would only refuse.
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
        },
      });
    });
  });

  await terminate(child, closed, posix);
  return {
    stage,
    failure,
    initialize,
    session,
    stdoutNoise:
      noiseCount > stdoutNoise.length
        ? [...stdoutNoise, `… ${noiseCount - stdoutNoise.length} more`]
        : stdoutNoise,
    stderrTail,
    elapsedMs: Date.now() - started,
  };
}

/** SIGTERM, then SIGKILL if the agent ignores it; the probe never leaves one behind. */
async function terminate(
  child: ChildProcessWithoutNullStreams,
  closed: Promise<void>,
  posix: boolean,
): Promise<void> {
  if (child.pid === undefined) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    await Promise.race([closed, delay(KILL_GRACE_MS)]);
    return;
  }
  const signal = (name: NodeJS.Signals): void => {
    try {
      if (posix) process.kill(-child.pid!, name);
      else child.kill(name);
    } catch {
      /* already gone */
    }
  };
  signal("SIGTERM");
  const exited = await Promise.race([
    closed.then(() => true),
    delay(KILL_GRACE_MS).then(() => false),
  ]);
  if (!exited) {
    signal("SIGKILL");
    await Promise.race([closed, delay(KILL_GRACE_MS)]);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms).unref());
}

function lines(onLine: (line: string) => void): (chunk: Buffer) => void {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line.trim()) onLine(line);
      newline = buffer.indexOf("\n");
    }
  };
}
