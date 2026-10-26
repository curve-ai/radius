import assert from "node:assert/strict";
import { test } from "node:test";

import { WebSocket } from "ws";

import { harnessEnvironment, startBridge } from "./bridge.js";

const HARNESS = [
  "node",
  "-e",
  // Prints a non-ACP line first, then echoes whatever it is sent.
  "process.stdout.write('starting up\\n');process.stdin.on('data',d=>process.stdout.write(d));",
];

function events(sink: { stdout: string[]; frames: string[] }) {
  return {
    onStdout: (line: string) => sink.stdout.push(line),
    onStderr: () => {},
    onExit: () => {},
    onSpawnError: (error: Error) => {
      throw error;
    },
    onConnect: () => {},
    onDisconnect: () => {},
    onFrame: (_d: string, m: Record<string, unknown>) =>
      sink.frames.push(JSON.stringify(m)),
  };
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
  const sink = { stdout: [] as string[], frames: [] as string[] };
  const bridge = await startBridge(HARNESS, process.cwd(), process.env, events(sink));
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
  } finally {
    await bridge.close();
  }
});

test("a second connection is refused, because stdio is one stream", async () => {
  const sink = { stdout: [] as string[], frames: [] as string[] };
  const bridge = await startBridge(HARNESS, process.cwd(), process.env, events(sink));
  const headers = { Authorization: `Bearer ${bridge.token}` };
  const first = new WebSocket(bridge.endpoint, { headers });
  await new Promise((settle) => first.once("open", settle));
  try {
    await assert.rejects(
      () =>
        new Promise((settle, reject) => {
          const second = new WebSocket(bridge.endpoint, { headers });
          second.once("open", () => {
            second.close();
            settle(null);
          });
          second.once("error", reject);
        }),
      "two clients would interleave writes on one stdin",
    );
  } finally {
    first.close();
    await bridge.close();
  }
});

test("non-ACP stdout is surfaced but never forwarded to the client", async () => {
  const sink = { stdout: [] as string[], frames: [] as string[] };
  const bridge = await startBridge(HARNESS, process.cwd(), process.env, events(sink));
  const socket = new WebSocket(bridge.endpoint, {
    headers: { Authorization: `Bearer ${bridge.token}` },
  });
  await new Promise((settle) => socket.once("open", settle));
  const received: string[] = [];
  socket.on("message", (data) => received.push(data.toString()));
  socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }));
  await new Promise((settle) => setTimeout(settle, 400));
  socket.close();
  await bridge.close();

  assert.ok(
    sink.stdout.some((line) => line.includes("starting up")),
    "a stray stdout line must be surfaced to the developer",
  );
  assert.ok(
    received.every((frame) => !frame.includes("starting up")),
    "a stray stdout line must never reach the JSON-RPC stream",
  );
  assert.equal(received.length, 1, "the echoed frame should still arrive");
});
