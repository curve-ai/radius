import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";

import { WebSocketServer, type WebSocket } from "ws";

import { OperationalError } from "./errors.js";

/**
 * Bridges one loopback WebSocket to a harness's stdio.
 *
 * Every ACP harness speaks stdio, but `DevelopmentAgentConnectionSchema`
 * admits only a `ws://` endpoint, so the descriptor the desktop watches cannot
 * name a process. Until that schema gains a transport union (CUR-42), the CLI
 * closes the gap here and the desktop stays unchanged.
 */
export interface Bridge {
  readonly endpoint: string;
  readonly token: string;
  readonly child: ChildProcessWithoutNullStreams;
  close(): Promise<void>;
}

export interface BridgeEvents {
  onStdout(line: string): void;
  onStderr(line: string): void;
  onExit(code: number | null, signal: NodeJS.Signals | null): void;
  onSpawnError(error: OperationalError): void;
  onConnect(): void;
  onDisconnect(): void;
  onFrame(direction: "client" | "harness", message: Record<string, unknown>): void;
}

/**
 * The harness is third-party code. It needs a usable environment — PATH for
 * npx, and whatever provider keys the developer has exported, since harnesses
 * like deepagents read ANTHROPIC_API_KEY straight from the environment — but
 * it must not inherit Radius's own credentials. RADIUS_ACCESS_TOKEN is the
 * non-interactive credential named in ADR-008; handing it to a downloaded
 * binary would let any harness act as the developer against the platform.
 */
export function harnessEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const carried: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith("RADIUS_")) continue;
    carried[key] = value;
  }
  return carried;
}

export async function startBridge(
  command: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  events: BridgeEvents,
): Promise<Bridge> {
  const [executable, ...args] = command;
  const child = spawn(executable as string, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: harnessEnvironment(env),
  }) as ChildProcessWithoutNullStreams;

  // Reported, never thrown: a throw inside an async listener cannot reach the
  // caller's catch, so it would escape the 0/1/2/70 taxonomy as an uncaught
  // exception. The handler decides what a dead harness means.
  child.once("error", (error) =>
    events.onSpawnError(
      new OperationalError(
        `Could not start the harness: ${error.message}`,
        `Command: ${command.join(" ")}`,
      ),
    ),
  );
  child.once("exit", events.onExit);
  child.stderr.on("data", split(events.onStderr));

  // Loopback is not a trust boundary — the process on the other end runs code —
  // so the bridge requires the bearer token handed to the desktop in the
  // descriptor, which the desktop already knows how to send.
  const token = randomBytes(24).toString("hex");
  let socket: WebSocket | null = null;

  const httpServer = createServer((_request, response) => {
    response.writeHead(426).end("Upgrade required");
  });
  const wsServer = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request: IncomingMessage, raw, head) => {
    const authorized = matchesToken(request.headers.authorization, token);
    // stdio is a single stream: a second client would interleave on one stdin.
    if (!authorized || socket) {
      raw.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      raw.destroy();
      return;
    }
    wsServer.handleUpgrade(request, raw, head, (accepted) => {
      socket = accepted;
      events.onConnect();
      accepted.on("message", (data) => {
        const line = data.toString();
        tee(line, "client", events);
        child.stdin.write(`${line}\n`);
      });
      accepted.once("close", () => {
        socket = null;
        events.onDisconnect();
      });
    });
  });

  child.stdout.on(
    "data",
    split((line) => {
      try {
        JSON.parse(line);
      } catch {
        // Tolerated and surfaced rather than forwarded: one stray console.log
        // must not corrupt the JSON-RPC stream.
        events.onStdout(line);
        return;
      }
      tee(line, "harness", events);
      socket?.send(line);
    }),
  );

  // Port 0: the endpoint is discovered from the actual bind and written into
  // the descriptor, so a second `dev` never collides on a fixed port.
  await new Promise<void>((ready) => httpServer.listen(0, "127.0.0.1", ready));
  const address = httpServer.address();
  if (typeof address === "string" || address === null) {
    throw new OperationalError("Could not determine the bridge port.");
  }

  return {
    endpoint: `ws://127.0.0.1:${address.port}`,
    token,
    child,
    async close() {
      socket?.close();
      child.kill();
      await new Promise<void>((done) => httpServer.close(() => done()));
    },
  };
}

/** Constant-time, so the comparison leaks nothing about the token. */
function matchesToken(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`, "utf8");
  const offered = Buffer.from(header ?? "", "utf8");
  return (
    offered.length === expected.length && timingSafeEqual(offered, expected)
  );
}

function tee(
  line: string,
  direction: "client" | "harness",
  events: BridgeEvents,
): void {
  try {
    events.onFrame(direction, JSON.parse(line) as Record<string, unknown>);
  } catch {
    /* not a frame; already surfaced */
  }
}

function split(onLine: (line: string) => void): (chunk: Buffer) => void {
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
