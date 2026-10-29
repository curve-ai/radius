import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough } from "node:stream";

import {
  AcpAuthenticationRequiredError,
  AcpProtocolVersionMismatchError,
  AcpRuntimeSession,
  acpStreamFromChild,
  type SessionConfigOption,
} from "@curve-ai/radius-runtime";

import { harnessEnvironment, splitLines, stopChild } from "./bridge.js";
import { OperationalError } from "./errors.js";

/**
 * Long enough for `npx -y` or `uvx` to fetch a package on first use, which is
 * the slowest thing a healthy start does. A harness that has not answered by
 * then is not going to.
 */
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 120_000;

export interface HandshakeResult {
  readonly protocolVersion: number;
  readonly authMethods: readonly string[];
  /** See {@link advertisedAgents}; empty for a single-agent harness. */
  readonly advertisedAgents: readonly string[];
  /**
   * The harness answered `initialize` but wants credentials before
   * `session/new`. That still proves it starts and speaks ACP, which is all a
   * preflight is for; the desktop runs the sign-in itself on a real thread.
   */
  readonly authRequired: boolean;
}

export interface HandshakeOptions {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly onStderr?: (line: string) => void;
  readonly onStdout?: (line: string) => void;
  readonly timeoutMs?: number;
}

/**
 * Starts the command once, runs `initialize` and `session/new` against its
 * stdio, then kills it.
 *
 * Stops at `session/new` for the same reason `verifyBuild` does: a prompt
 * needs a provider credential, and starting `dev` must not. What this proves
 * is narrower and is what `dev` needs before it registers anything — that the
 * command exists, stays up and speaks the protocol.
 */
export async function handshakeOverStdio(
  options: HandshakeOptions,
): Promise<HandshakeResult> {
  const { command } = options;
  const [executable, ...args] = command;
  const child = spawn(executable as string, args, {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: harnessEnvironment(options.env),
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;

  // Kept for the failure message: "exited with code 1" says nothing a
  // developer can act on, and the harness's last words usually do.
  let stderrTail = "";
  child.stderr.on(
    "data",
    splitLines((line) => {
      stderrTail = `${stderrTail}${line}\n`.slice(-4_096);
      options.onStderr?.(line);
    }),
  );
  child.stdin.on("error", () => {
    /* EPIPE after an early exit; the exit itself is what gets reported */
  });

  // The SDK answers a non-JSON line with a parse error written back to the
  // harness. Filtering here keeps the preflight's view of stdout identical to
  // the bridge's, so a harness that logs to stdout passes both or neither.
  const frames = new PassThrough();
  child.stdout.on(
    "data",
    splitLines((line) => {
      try {
        JSON.parse(line);
      } catch {
        options.onStdout?.(line);
        return;
      }
      frames.write(`${line}\n`);
    }),
  );
  child.stdout.once("end", () => frames.end());

  const described = command.join(" ");
  const failed = new Promise<never>((_settle, reject) => {
    child.once("error", (error) =>
      reject(
        new OperationalError(
          `Could not start the harness: ${error.message}`,
          `Command: ${described}`,
        ),
      ),
    );
    child.once("exit", (code, signal) =>
      reject(
        new OperationalError(
          `The harness exited before completing the ACP handshake (code ${String(code)}, signal ${String(signal)}).`,
          stderrTail.trim()
            ? `Command: ${described}\n\n${stderrTail.trim()}`
            : `Command: ${described}`,
        ),
      ),
    );
  });
  const timeoutMs = options.timeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_settle, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new OperationalError(
            `The harness did not answer the ACP handshake within ${Math.round(timeoutMs / 1000)}s.`,
            `Command: ${described}\n\nAn ACP agent reads JSON-RPC on stdin and writes it on stdout; check it is not waiting on a flag or a TTY.`,
          ),
        ),
      timeoutMs,
    );
  });

  let session: AcpRuntimeSession | null = null;
  try {
    const connecting = AcpRuntimeSession.connect(
      acpStreamFromChild({
        stdin: child.stdin,
        stdout: frames as unknown as ChildProcessWithoutNullStreams["stdout"],
        stderr: child.stderr,
        kill: child.kill.bind(child),
        once: child.once.bind(child),
      }),
      {
        cwd: options.cwd,
        clientName: "radius-cli",
        // No prompt is sent, so nothing should ask; refuse if anything does.
        handlers: {
          onPermissionRequest: async () => ({ outcome: "cancelled" }),
        },
      },
    );
    // The losing promises reject later, when the child is killed below.
    // Swallowed so that rejection is not reported as unhandled.
    failed.catch(() => {});
    timedOut.catch(() => {});
    session = await Promise.race([connecting, failed, timedOut]);
    return {
      protocolVersion: session.protocolVersion,
      authMethods: session.authMethods.map((method) => method.id),
      advertisedAgents: advertisedAgents(session),
      authRequired: false,
    };
  } catch (error) {
    if (error instanceof AcpAuthenticationRequiredError) {
      return {
        protocolVersion: 1,
        authMethods: error.authMethods.map((method) => method.id),
        advertisedAgents: [],
        authRequired: true,
      };
    }
    if (error instanceof OperationalError) throw error;
    if (error instanceof AcpProtocolVersionMismatchError) {
      throw new OperationalError(error.message, `Command: ${described}`);
    }
    // A harness that dies closes stdout before its `exit` event fires, so the
    // SDK's "connection closed" usually wins the race. The exit carries the
    // code and the stderr that explain it, so it is given a moment to land.
    const exited = await Promise.race([
      failed.then(
        () => null,
        (reason: unknown) => reason,
      ),
      new Promise<null>((settle) => setTimeout(() => settle(null), 1_000)),
    ]);
    if (exited instanceof OperationalError) throw exited;
    throw new OperationalError(
      `The harness did not complete the ACP handshake: ${error instanceof Error ? error.message : String(error)}`,
      `Command: ${described}`,
    );
  } finally {
    clearTimeout(timer);
    session?.close();
    await stopChild(child);
  }
}

/**
 * The agents a session says it can run.
 *
 * ACP has no agent list of its own, so a harness projects one through the
 * extension points it does have: `sessionModes` where the harness models an
 * agent as a mode, and a `mode`-category config option otherwise. Both are
 * read because harnesses differ, and an empty result is reported rather than
 * treated as a failure — a single-agent harness advertises neither.
 */
export function advertisedAgents(session: {
  sessionModes:
    | {
        availableModes?: ReadonlyArray<{ id?: string; name?: string }>;
      }
    | null
    | undefined;
  sessionConfigOptions: readonly SessionConfigOption[];
}): string[] {
  const fromModes = (session.sessionModes?.availableModes ?? [])
    .map((mode) => mode.id ?? mode.name)
    .filter((name): name is string => Boolean(name));
  if (fromModes.length > 0) return fromModes;

  const option = session.sessionConfigOptions.find(
    (candidate) => candidate.category === "mode" || candidate.id === "mode",
  );
  if (!option || option.type !== "select") return [];
  // A select's options are either a flat list or grouped; both shapes carry
  // the same leaf, so flatten rather than branch on which arrived.
  return option.options.flatMap((entry) =>
    "options" in entry
      ? entry.options.map((leaf) => leaf.value)
      : [entry.value],
  );
}
