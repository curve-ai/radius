import type { AgentConfig } from "@curve-ai/agent-contracts";
import { DevelopmentAgentConnectionSchema } from "@curve-ai/radius-runtime";
import { WebSocket } from "ws";

import { OperationalError, UsageError } from "./errors.js";
import { advertisedFromSession, type HandshakeResult } from "./handshake.js";

const ATTACH_HANDSHAKE_TIMEOUT_MS = 15_000;

/** ACP's `auth_required`, which an agent returns from `session/new`. */
const ACP_AUTH_REQUIRED_CODE = -32000;

export interface AttachTarget {
  readonly endpoint: string;
  /** The full header value, or null for an agent that takes none. */
  readonly authorization: string | null;
}

/**
 * Whether `dev` attaches to an agent the developer runs, and to what.
 *
 * Null keeps the default, where Radius starts the agent. The flag wins over
 * `development.endpoint`, so one run can point somewhere else without editing
 * the config.
 */
export function resolveAttachTarget(
  config: AgentConfig,
  flags: {
    readonly endpoint?: string;
    readonly "authorization-env"?: string;
  },
  env: NodeJS.ProcessEnv,
): AttachTarget | null {
  const endpoint = flags.endpoint ?? config.development?.endpoint;
  if (!endpoint) return null;
  const parsed =
    DevelopmentAgentConnectionSchema.shape.endpoint.safeParse(endpoint);
  if (!parsed.success) {
    throw new UsageError(
      `Cannot attach to ${endpoint}: ${parsed.error.issues[0]?.message ?? "invalid endpoint"}.`,
    );
  }
  const variable =
    flags["authorization-env"] ?? config.development?.authorizationEnv;
  if (!variable) return { endpoint, authorization: null };
  const value = env[variable]?.trim();
  if (!value) {
    throw new UsageError(`The authorization variable ${variable} is empty.`);
  }
  return { endpoint, authorization: `Bearer ${value}` };
}

/**
 * The attach counterpart of `handshakeOverStdio`: `initialize` then
 * `session/new`, so nothing registers for an agent the app could not use.
 * Closes only its own socket. The agent belongs to the developer.
 */
export function handshakeOverWebSocket(
  target: AttachTarget,
  cwd: string,
  timeoutMs = ATTACH_HANDSHAKE_TIMEOUT_MS,
): Promise<HandshakeResult> {
  const { endpoint, authorization } = target;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      endpoint,
      authorization ? { headers: { Authorization: authorization } } : {},
    );
    const finish = (settle: () => void): void => {
      clearTimeout(timer);
      socket.removeAllListeners();
      // A late socket error must not become an uncaught exception.
      socket.on("error", () => {});
      socket.terminate();
      settle();
    };
    const fail = (message: string, nextAction?: string): void =>
      finish(() => reject(new OperationalError(message, nextAction)));
    const notAcp = `This command only attaches to an agent speaking ACP over a WebSocket.`;
    const timer = setTimeout(
      () =>
        fail(
          `${endpoint} did not answer the ACP handshake within ${Math.round(timeoutMs / 1000)}s.`,
          notAcp,
        ),
      timeoutMs,
    );

    let authMethods: string[] = [];
    let protocolVersion = 0;
    socket.on("error", (error) =>
      fail(
        `Could not connect to ${endpoint}: ${error.message}`,
        `Start your agent first, then run \`radius dev\` again. ${notAcp}`,
      ),
    );
    socket.on("close", () =>
      fail(
        `${endpoint} closed the connection during the ACP handshake.`,
        notAcp,
      ),
    );
    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: 1, clientCapabilities: {} },
        }),
      );
    });
    socket.on("message", (data) => {
      let message: {
        id?: unknown;
        result?: Record<string, unknown>;
        error?: { code?: number; message?: string };
      };
      try {
        message = JSON.parse(data.toString()) as typeof message;
      } catch {
        fail(`${endpoint} sent something that is not JSON-RPC.`, notAcp);
        return;
      }
      if (message.id !== 1 && message.id !== 2) return;
      if (message.error) {
        if (message.id === 2 && message.error.code === ACP_AUTH_REQUIRED_CODE) {
          finish(() =>
            resolve({
              protocolVersion,
              authMethods,
              advertisedAgents: [],
              authRequired: true,
            }),
          );
          return;
        }
        fail(
          `${endpoint} refused the ACP handshake: ${String(message.error.message)}`,
        );
        return;
      }
      if (message.id === 1) {
        protocolVersion = Number(message.result?.protocolVersion);
        if (protocolVersion !== 1) {
          fail(
            `${endpoint} answered with ACP protocol version ${String(message.result?.protocolVersion)}; Radius speaks version 1.`,
          );
          return;
        }
        const methods = message.result?.authMethods;
        authMethods = Array.isArray(methods)
          ? methods
              .map((method) => (method as { id?: unknown } | null)?.id)
              .filter((id): id is string => typeof id === "string")
          : [];
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "session/new",
            params: { cwd, mcpServers: [] },
          }),
        );
        return;
      }
      const session = message.result ?? {};
      finish(() =>
        resolve({
          protocolVersion,
          authMethods,
          advertisedAgents: advertisedFromSession(session),
          authRequired: false,
        }),
      );
    });
  });
}
