import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";

import { WebSocket } from "ws";

import {
  harnessEnvironment,
  startBridge,
  type Bridge,
  type BridgeEvents,
} from "./bridge.js";
import { FAKE_ACP_COMMAND } from "./test-agents.js";

const HARNESS = [
  "node",
  "-e",
  // Prints a non-ACP line first, then echoes whatever it is sent.
  "process.stdout.write('starting up\\n');process.stdin.on('data',d=>process.stdout.write(d));",
];

interface Sink {
  stdout: string[];
  frames: string[];
  exits: Array<{ id: string; code: number | null }>;
  connects: string[];
  disconnects: string[];
}

function sink(): Sink {
  return { stdout: [], frames: [], exits: [], connects: [], disconnects: [] };
}

function events(into: Sink): BridgeEvents {
  return {
    onStdout: (_id, line) => into.stdout.push(line),
    onStderr: () => {},
    onExit: (id, code) => into.exits.push({ id, code }),
    onSpawnError: (_id, error) => {
      throw error;
    },
    onConnect: (id) => into.connects.push(id),
    onDisconnect: (id) => into.disconnects.push(id),
    onFrame: (_id, _direction, message) =>
      into.frames.push(JSON.stringify(message)),
  };
}

async function connect(bridge: Bridge): Promise<WebSocket> {
  const socket = new WebSocket(bridge.endpoint, {
    headers: { Authorization: `Bearer ${bridge.token}` },
  });
  await once(socket, "open");
  return socket;
}

let nextId = 1;
/** Sends one request and resolves with its result. */
async function request(
  socket: WebSocket,
  method: string,
): Promise<Record<string, unknown>> {
  const id = nextId++;
  return new Promise((settle, reject) => {
    const onMessage = (data: Buffer): void => {
      const message = JSON.parse(data.toString()) as {
        id?: number;
        result?: Record<string, unknown>;
      };
      if (message.id !== id) return;
      socket.off("message", onMessage);
      settle(message.result ?? {});
    };
    socket.on("message", onMessage);
    socket.once("close", () => reject(new Error(`closed before ${method}`)));
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method }));
  });
}

async function pidOf(socket: WebSocket): Promise<number> {
  return (await request(socket, "test/pid")).pid as number;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting: ${label}`);
    await new Promise((settle) => setTimeout(settle, 20));
  }
}

test("Radius credentials are never handed to the harness", () => {
  const carried = harnessEnvironment({
    PATH: "/usr/bin",
    ANTHROPIC_API_KEY: "sk-test",
    RADIUS_ACCESS_TOKEN: "secret",
    RADIUS_USER_DATA_PATH: "/tmp/x",
  });
  assert.equal(carried.PATH, "/usr/bin");
  assert.equal(
    carried.ANTHROPIC_API_KEY,
    "sk-test",
    "a provider key the developer exported must still reach the harness",
  );
  assert.equal(carried.RADIUS_ACCESS_TOKEN, undefined);
  assert.equal(carried.RADIUS_USER_DATA_PATH, undefined);
});

test("an upgrade without the bearer token is refused", async () => {
  const bridge = await startBridge(
    HARNESS,
    process.cwd(),
    process.env,
    events(sink()),
  );
  try {
    await assert.rejects(
      () =>
        new Promise((settle, reject) => {
          const socket = new WebSocket(bridge.endpoint);
          socket.once("open", () => {
            socket.close();
            settle(null);
          });
          socket.once("error", reject);
        }),
      "loopback is not a trust boundary when the far end runs code",
    );
    assert.equal(bridge.connections(), 0, "a refused upgrade spawns nothing");
  } finally {
    await bridge.close();
  }
});

test(
  "two concurrent threads each get their own harness process",
  { timeout: 15_000 },
  async () => {
    const into = sink();
    const bridge = await startBridge(
      FAKE_ACP_COMMAND,
      process.cwd(),
      process.env,
      events(into),
    );
    try {
      const first = await connect(bridge);
      const second = await connect(bridge);
      const [a, b] = await Promise.all([pidOf(first), pidOf(second)]);
      assert.notEqual(a, b, "two threads must not share one stdin");
      assert.equal(bridge.connections(), 2);
      assert.equal(
        new Set(into.connects).size,
        2,
        "each socket gets its own id",
      );
      first.close();
      second.close();
    } finally {
      await bridge.close();
    }
  },
);

test(
  "closing one thread kills only that thread's harness",
  { timeout: 15_000 },
  async () => {
    const into = sink();
    const bridge = await startBridge(
      FAKE_ACP_COMMAND,
      process.cwd(),
      process.env,
      events(into),
    );
    try {
      const first = await connect(bridge);
      const second = await connect(bridge);
      const [a, b] = await Promise.all([pidOf(first), pidOf(second)]);

      first.close();
      await until(() => !alive(a), "the closed thread's harness to exit");
      assert.ok(alive(b), "the other thread's harness must keep running");
      assert.equal(await pidOf(second), b, "and keep answering");
      assert.deepEqual(
        into.exits,
        [],
        "a harness the bridge stopped is a closed thread, not a crash",
      );
      second.close();
    } finally {
      await bridge.close();
    }
  },
);

test(
  "a crashing harness closes only its own socket",
  { timeout: 15_000 },
  async () => {
    const into = sink();
    const bridge = await startBridge(
      FAKE_ACP_COMMAND,
      process.cwd(),
      process.env,
      events(into),
    );
    try {
      const doomed = await connect(bridge);
      const survivor = await connect(bridge);
      const before = await pidOf(survivor);

      const closed = once(doomed, "close") as Promise<[number, Buffer]>;
      doomed.send(JSON.stringify({ jsonrpc: "2.0", method: "test/crash" }));
      const [code] = await closed;
      assert.equal(code, 1011, "a crash reads as a failure to the desktop");
      assert.equal(into.exits.length, 1);
      assert.equal(into.exits[0]?.code, 1);

      assert.equal(
        await pidOf(survivor),
        before,
        "the other thread is untouched",
      );
      // A later thread gets a fresh process; the crash did not poison the door.
      const later = await connect(bridge);
      assert.notEqual(await pidOf(later), before);
      survivor.close();
      later.close();
    } finally {
      await bridge.close();
    }
  },
);

test(
  "closing the bridge kills every thread's harness",
  { timeout: 15_000 },
  async () => {
    const bridge = await startBridge(
      FAKE_ACP_COMMAND,
      process.cwd(),
      process.env,
      events(sink()),
    );
    const sockets = [await connect(bridge), await connect(bridge)];
    const pids = await Promise.all(sockets.map(pidOf));
    await bridge.close();
    for (const pid of pids) assert.equal(alive(pid), false);
  },
);

test(
  "non-ACP stdout is surfaced but never forwarded to the client",
  { timeout: 15_000 },
  async (context) => {
    const into = sink();
    const bridge = await startBridge(
      HARNESS,
      process.cwd(),
      process.env,
      events(into),
    );
    const socket = new WebSocket(bridge.endpoint, {
      headers: { Authorization: `Bearer ${bridge.token}` },
    });
    const received: string[] = [];
    try {
      await once(socket, "open", { signal: context.signal });
      socket.on("message", (data) => received.push(data.toString()));
      const echoed = once(socket, "message", { signal: context.signal });
      socket.send(
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      );
      await echoed;
    } finally {
      socket.close();
      await bridge.close();
    }

    assert.ok(
      into.stdout.some((line) => line.includes("starting up")),
      "a stray stdout line must be surfaced to the developer",
    );
    assert.ok(
      received.every((frame) => !frame.includes("starting up")),
      "a stray stdout line must never reach the JSON-RPC stream",
    );
    assert.equal(received.length, 1, "the echoed frame should still arrive");
  },
);
