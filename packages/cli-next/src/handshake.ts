import type { SessionConfigOption } from "@curve-ai/radius-runtime";

import { probeAcp, type ProbeResult } from "./acp-probe.js";
import { OperationalError } from "./errors.js";

/**
 * Long enough for `npx -y` or `uvx` to fetch a package on first use, which is
 * the slowest thing a healthy start does. A harness that has not answered by
 * then is not going to.
 */
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 120_000;

/** ACP's `auth_required`, which an agent returns from `session/new`. */
const ACP_AUTH_REQUIRED_CODE = -32000;

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
 * command exists, stays up and speaks the protocol. The probe is `check`'s
 * too, so the two can never disagree about whether a harness starts.
 */
export async function handshakeOverStdio(
  options: HandshakeOptions,
): Promise<HandshakeResult> {
  const probe = await probeAcp({
    command: options.command,
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
    onStderrLine: options.onStderr,
    onStdoutNoise: options.onStdout,
  });
  const described = options.command.join(" ");
  const authMethods = readAuthMethods(probe.initialize);
  const failure = probe.failure;
  if (!failure) {
    const protocolVersion = probe.initialize?.protocolVersion;
    if (protocolVersion !== 1) {
      throw new OperationalError(
        `The harness answered with ACP protocol version ${String(protocolVersion)}; Radius speaks version 1.`,
        `Command: ${described}`,
      );
    }
    return {
      protocolVersion,
      authMethods,
      advertisedAgents: probe.session
        ? advertisedFromSession(probe.session)
        : [],
      authRequired: false,
    };
  }
  switch (failure.kind) {
    case "rpc":
      // Still a pass: the harness started and speaks ACP, and the desktop
      // runs the sign-in itself on a real thread.
      if (
        probe.stage === "session/new" &&
        failure.code === ACP_AUTH_REQUIRED_CODE
      ) {
        return {
          protocolVersion: 1,
          authMethods,
          advertisedAgents: [],
          authRequired: true,
        };
      }
      throw new OperationalError(
        `The harness did not complete the ACP handshake: ${failure.message}`,
        `Command: ${described}`,
      );
    case "spawn":
      throw new OperationalError(
        `Could not start the harness: ${failure.message}`,
        `Command: ${described}`,
      );
    case "exit":
      // "exited with code 1" says nothing a developer can act on, and the
      // harness's last words usually do.
      throw new OperationalError(
        `The harness exited before completing the ACP handshake (code ${String(failure.code)}, signal ${String(failure.signal)}).`,
        withStderr(described, probe),
      );
    case "timeout":
      throw new OperationalError(
        `The harness did not answer the ACP handshake within ${Math.round(failure.afterMs / 1000)}s.`,
        `Command: ${described}\n\nAn ACP agent reads JSON-RPC on stdin and writes it on stdout; check it is not waiting on a flag or a TTY.`,
      );
    case "aborted":
      throw new OperationalError("The ACP handshake was interrupted.");
  }
}

function withStderr(described: string, probe: ProbeResult): string {
  const tail = probe.stderrTail.trim();
  return tail ? `Command: ${described}\n\n${tail}` : `Command: ${described}`;
}

function readAuthMethods(initialize: Record<string, unknown> | null): string[] {
  const methods = initialize?.authMethods;
  return Array.isArray(methods)
    ? methods
        .map((method) => (isRecord(method) ? method.id : undefined))
        .filter((id): id is string => typeof id === "string")
    : [];
}

/**
 * The agents a raw `session/new` result advertises. The result is untrusted
 * input from a third-party process, so it is narrowed before
 * {@link advertisedAgents} reads it.
 */
export function advertisedFromSession(
  session: Record<string, unknown>,
): string[] {
  const modes = isRecord(session.modes) ? session.modes : null;
  const availableModes = Array.isArray(modes?.availableModes)
    ? modes.availableModes.filter(isRecord)
    : [];
  const configOptions = Array.isArray(session.configOptions)
    ? session.configOptions.filter(isWellFormedOption)
    : [];
  return advertisedAgents({
    sessionModes: { availableModes },
    sessionConfigOptions: configOptions as SessionConfigOption[],
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWellFormedOption(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type !== "select") return true;
  if (!Array.isArray(value.options)) return false;
  return value.options.every(
    (entry) =>
      isRecord(entry) &&
      (Array.isArray(entry.options)
        ? entry.options.every(
            (leaf) => isRecord(leaf) && typeof leaf.value === "string",
          )
        : typeof entry.value === "string"),
  );
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
