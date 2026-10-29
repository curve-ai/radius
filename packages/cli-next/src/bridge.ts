import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";

import { WebSocketServer, type WebSocket } from "ws";

import { OperationalError } from "./errors.js";

/**
 * Bridges loopback WebSockets to harness stdio, one process per socket.
 *
 * Every ACP harness speaks stdio, but `DevelopmentAgentConnectionSchema`
 * admits only a `ws://` endpoint, so the descriptor the desktop watches cannot
 * name a process. Until that schema gains a transport union, the CLI
 * closes the gap here and the desktop stays unchanged.
 *
 * The desktop opens a new socket for every thread and runs `initialize` and
 * `session/new` on each, the same way it boots a fresh microVM per run for a
 * packaged agent. So the bridge starts a harness when a socket arrives and
 * kills it when the socket goes. One stdin per client is what lets two
 * threads run at once, and it makes `dev` behave like production rather than
 * like one long-lived process being re-initialized.
 */
export interface Bridge {
  readonly endpoint: string;
  readonly token: string;
  /** Sockets that currently own a harness process. */
  connections(): number;
  close(): Promise<void>;
}

/**
 * Every event names the connection it belongs to, a short id minted when the
 * socket is accepted, so concurrent threads' output can be told apart.
 */
export interface BridgeEvents {
  onStdout(connection: string, line: string): void;
  onStderr(connection: string, line: string): void;
  /**
   * The harness exited on its own. Not reported when the bridge killed it
   * because its socket closed or the bridge shut down: that is the normal end
   * of a thread, not news.
   */
  onExit(
    connection: string,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void;
  onSpawnError(connection: string, error: OperationalError): void;
  onConnect(connection: string): void;
  onDisconnect(connection: string): void;
  onFrame(
    connection: string,
    direction: "client" | "harness",
    message: Record<string, unknown>,
  ): void;
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

interface Connection {
  readonly socket: WebSocket;
  readonly child: ChildProcessWithoutNullStreams;
  /** Set once the bridge has decided this child should end, so its exit is quiet. */
  ending: boolean;
}

export async function startBridge(
  command: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  events: BridgeEvents,
): Promise<Bridge> {
  // Loopback is not a trust boundary — the process on the other end runs code —
  // so the bridge requires the bearer token handed to the desktop in the
  // descriptor, which the desktop already knows how to send.
  const token = randomBytes(24).toString("hex");
  const live = new Map<string, Connection>();
  let closing = false;

  const httpServer = createServer((_request, response) => {
    response.writeHead(426).end("Upgrade required");
  });
  const wsServer = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request: IncomingMessage, raw, head) => {
    if (closing || !matchesToken(request.headers.authorization, token)) {
      raw.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      raw.destroy();
      return;
    }
    wsServer.handleUpgrade(request, raw, head, (socket) => {
      const id = mintConnectionId(live);
      events.onConnect(id);
      const connection = attach(id, socket, command, cwd, env, events);
      live.set(id, connection);
      socket.once("close", () => {
        live.delete(id);
        connection.ending = true;
        void stopChild(connection.child);
        events.onDisconnect(id);
      });
    });
  });

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
    connections: () => live.size,
    async close() {
      closing = true;
      const ending = [...live.values()];
      for (const connection of ending) {
        connection.ending = true;
        connection.socket.terminate();
      }
      // Awaited rather than fired: a harness still running after `dev`
      // returns is an orphan holding the provider keys from the developer's
      // shell.
      await Promise.all(ending.map(({ child }) => stopChild(child)));
      await new Promise<void>((done) => httpServer.close(() => done()));
    },
  };
}

/** Wires one accepted socket to a freshly spawned harness. */
function attach(
  id: string,
  socket: WebSocket,
  command: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  events: BridgeEvents,
): Connection {
  const [executable, ...args] = command;
  const child = spawn(executable as string, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: harnessEnvironment(env),
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;
  const connection: Connection = { socket, child, ending: false };

  // Reported, never thrown: a throw inside an async listener cannot reach the
  // caller's catch, so it would escape the 0/1/2/70 taxonomy as an uncaught
  // exception. The handler decides what a dead harness means.
  child.once("error", (error) => {
    if (connection.ending) return;
    connection.ending = true;
    events.onSpawnError(
      id,
      new OperationalError(
        `Could not start the harness: ${error.message}`,
        `Command: ${command.join(" ")}`,
      ),
    );
    socket.close(1011, "harness failed to start");
  });
  // A harness that dies takes only its own thread with it. 1011 rather than
  // 1000 for a crash, so the desktop reports a failure instead of a session
  // that simply ended.
  child.once("exit", (code, signal) => {
    if (connection.ending) return;
    connection.ending = true;
    events.onExit(id, code, signal);
    socket.close(code === 0 ? 1000 : 1011, "harness exited");
  });
  child.stderr.on(
    "data",
    splitLines((line) => events.onStderr(id, line)),
  );

  // A harness that dies mid-session makes the next stdin write fail with
  // EPIPE. Without a listener that is an uncaught exception, which takes the
  // process down before the descriptor is removed — leaving a registration
  // pointing at an endpoint nobody is serving.
  child.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") return;
    events.onStderr(
      id,
      `[bridge] could not write to the harness: ${error.message}`,
    );
  });

  socket.on("message", (data) => {
    const line = data.toString();
    tee(id, line, "client", events);
    // Checked rather than attempted: writing to a closed stdin is a
    // normal consequence of the harness exiting, not an error worth
    // raising at the client.
    if (child.stdin.writable) child.stdin.write(`${line}\n`);
  });

  child.stdout.on(
    "data",
    splitLines((line) => {
      try {
        JSON.parse(line);
      } catch {
        // Tolerated and surfaced rather than forwarded: one stray console.log
        // must not corrupt the JSON-RPC stream.
        events.onStdout(id, line);
        return;
      }
      tee(id, line, "harness", events);
      if (socket.readyState === socket.OPEN) socket.send(line);
    }),
  );
  return connection;
}

/** Four hex characters: enough to tell a handful of open threads apart. */
function mintConnectionId(live: ReadonlyMap<string, unknown>): string {
  for (;;) {
    const id = randomBytes(2).toString("hex");
    if (!live.has(id)) return id;
  }
}

/**
 * SIGTERM, then SIGKILL after a grace period. A harness that ignores SIGTERM
 * would otherwise outlive the CLI that started it.
 */
export async function stopChild(
  child: ChildProcessWithoutNullStreams,
  graceMs = 2_000,
): Promise<void> {
  // A child that never spawned has no pid and will never emit `exit`.
  if (child.pid === undefined) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((settle) =>
    child.once("exit", () => settle()),
  );
  child.kill();
  const timer = setTimeout(() => child.kill("SIGKILL"), graceMs);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
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
  id: string,
  line: string,
  direction: "client" | "harness",
  events: BridgeEvents,
): void {
  try {
    events.onFrame(id, direction, JSON.parse(line) as Record<string, unknown>);
  } catch {
    /* not a frame; already surfaced */
  }
}

/** Calls `onLine` once per non-blank line, across chunk boundaries. */
export function splitLines(
  onLine: (line: string) => void,
): (chunk: Buffer) => void {
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
