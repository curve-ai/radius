import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { test, type TestContext } from "node:test";

import { WebSocket, WebSocketServer } from "ws";

import devHandler from "./commands/dev/run.js";
import type { RadiusContext } from "./context.js";

const SPAWN_WOULD_FAIL = ["radius-test-command-that-does-not-exist"];

/** A failed assertion must not leave a socket holding the test process open. */
function closeWhenDone(t: TestContext, server: WebSocketServer): void {
  t.after(() => {
    for (const client of server.clients) client.terminate();
    server.close();
  });
}

/** An agent the developer runs themselves: ACP over a loopback WebSocket. */
async function runningAgent(t: TestContext, requiredAuthorization?: string) {
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    verifyClient: ({ req }: { req: IncomingMessage }) =>
      !requiredAuthorization ||
      req.headers.authorization === requiredAuthorization,
  });
  await once(server, "listening");
  closeWhenDone(t, server);
  server.on("connection", (socket) => {
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as {
        id: number;
        method: string;
      };
      const result =
        message.method === "initialize"
          ? { protocolVersion: 1, agentCapabilities: {}, authMethods: [] }
          : {
              sessionId: "attached",
              modes: {
                currentModeId: "ops",
                availableModes: [{ id: "ops", name: "Ops" }],
              },
            };
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
  });
  const { port } = server.address() as AddressInfo;
  return { server, endpoint: `ws://127.0.0.1:${port}/acp` };
}

async function project(development?: object) {
  const cwd = await mkdtemp(join(tmpdir(), "radius-attach-project-"));
  const userData = await mkdtemp(join(tmpdir(), "radius-attach-userdata-"));
  await writeFile(
    join(cwd, "radius.json"),
    JSON.stringify({
      schemaVersion: 1,
      agent: "agent_testtesttest",
      name: "Attached",
      runtime: { kind: "command", command: SPAWN_WOULD_FAIL },
      ...(development ? { development } : {}),
    }),
  );
  const notes: string[] = [];
  const stderr = new PassThrough();
  stderr.on("data", (chunk: Buffer) => notes.push(chunk.toString()));
  let release: () => void = () => {};
  const stopped = new Promise<void>((settle) => {
    release = settle;
  });
  let failed: number | null = null;
  const context = {
    process: {
      stdout: new PassThrough(),
      stderr,
      env: process.env,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
    },
    cwd,
    env: { ...process.env, RADIUS_USER_DATA_PATH: userData, AGENT_TOKEN: "s3" },
    isTTY: false,
    colour: false,
    output: "text",
    out: (message: string) => notes.push(message),
    note: (message: string) => notes.push(message),
    untilStopped: () => stopped,
    stop: () => release(),
    fail: (code: number) => {
      failed = code;
    },
    failure: () => failed,
  } as unknown as RadiusContext;
  const agentsDir = join(userData, "development", "agents");
  return {
    context,
    notes,
    failure: () => failed,
    descriptors: () => readdir(agentsDir).catch(() => [] as string[]),
    descriptor: async (name: string) =>
      JSON.parse(await readFile(join(agentsDir, name), "utf8")) as {
        endpoint: string;
        authorization: string | null;
      },
  };
}

const FLAGS = { verbose: false, "no-open": true, yes: false };

async function until(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((settle) => setTimeout(settle, 25));
  }
}

test("--endpoint registers the running agent, and Ctrl-C leaves it running", async (t) => {
  const agent = await runningAgent(t);
  const p = await project();
  const running = devHandler.call(p.context, {
    ...FLAGS,
    endpoint: agent.endpoint,
  });
  await until(async () => (await p.descriptors()).length === 1);

  const [name] = await p.descriptors();
  const registered = await p.descriptor(name!);
  assert.equal(registered.endpoint, agent.endpoint);
  assert.equal(registered.authorization, null);

  p.context.stop();
  await running;
  assert.equal(p.failure(), null);
  assert.deepEqual(await p.descriptors(), []);

  const after = new WebSocket(agent.endpoint);
  await once(after, "open");
  after.close();
});

test("development.endpoint attaches without the flag, and the flag wins over it", async (t) => {
  const configured = await runningAgent(t);
  const flagged = await runningAgent(t);

  const fromConfig = await project({ endpoint: configured.endpoint });
  const a = devHandler.call(fromConfig.context, FLAGS);
  await until(async () => (await fromConfig.descriptors()).length === 1);
  const [configName] = await fromConfig.descriptors();
  assert.equal(
    (await fromConfig.descriptor(configName!)).endpoint,
    configured.endpoint,
  );
  fromConfig.context.stop();
  await a;

  const fromFlag = await project({ endpoint: configured.endpoint });
  const b = devHandler.call(fromFlag.context, {
    ...FLAGS,
    endpoint: flagged.endpoint,
  });
  await until(async () => (await fromFlag.descriptors()).length === 1);
  const [flagName] = await fromFlag.descriptors();
  assert.equal(
    (await fromFlag.descriptor(flagName!)).endpoint,
    flagged.endpoint,
  );
  fromFlag.context.stop();
  await b;
});

test("--authorization-env sends the bearer value to the agent and the app", async (t) => {
  const agent = await runningAgent(t, "Bearer s3");
  const p = await project();
  const running = devHandler.call(p.context, {
    ...FLAGS,
    endpoint: agent.endpoint,
    "authorization-env": "AGENT_TOKEN",
  });
  await until(async () => (await p.descriptors()).length === 1);
  const [name] = await p.descriptors();
  assert.equal((await p.descriptor(name!)).authorization, "Bearer s3");
  p.context.stop();
  await running;
});

test("an empty authorization variable is a usage error", async () => {
  const p = await project();
  await devHandler.call(p.context, {
    ...FLAGS,
    endpoint: "ws://127.0.0.1:9/acp",
    "authorization-env": "RADIUS_TEST_UNSET_VARIABLE",
  });
  assert.equal(p.failure(), 2);
  assert.match(p.notes.join("\n"), /RADIUS_TEST_UNSET_VARIABLE/);
});

test("a remote endpoint is refused before anything registers", async () => {
  const p = await project();
  await devHandler.call(p.context, {
    ...FLAGS,
    endpoint: "wss://agents.example.com/acp",
  });
  assert.equal(p.failure(), 2);
  assert.deepEqual(await p.descriptors(), []);
});

test("an endpoint nothing answers on fails and says to start the agent", async (t) => {
  const agent = await runningAgent(t);
  await new Promise((settle) => agent.server.close(settle));
  const p = await project();
  await devHandler.call(p.context, { ...FLAGS, endpoint: agent.endpoint });
  assert.equal(p.failure(), 1);
  assert.deepEqual(await p.descriptors(), []);
  assert.match(p.notes.join("\n"), /Start your agent/);
});

test("an endpoint that does not speak ACP fails without registering", async (t) => {
  const silent = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(silent, "listening");
  closeWhenDone(t, silent);
  silent.on("connection", (socket) => {
    socket.on("message", () => socket.send("not json-rpc"));
  });
  const { port } = silent.address() as AddressInfo;
  const p = await project();
  await devHandler.call(p.context, {
    ...FLAGS,
    endpoint: `ws://127.0.0.1:${port}/acp`,
  });
  assert.equal(p.failure(), 1);
  assert.deepEqual(await p.descriptors(), []);
  assert.match(p.notes.join("\n"), /ACP/);
});

// In-process tests can't see this: the test runner keeps the event loop alive,
// and with no bridge socket a real `dev` has nothing else to do so.
test("an attached dev stays up as a real process until it is stopped", async (t) => {
  const agent = await runningAgent(t);
  const p = await project();
  const child = spawn(
    process.execPath,
    [
      "--import",
      // A file URL, because a bare name would resolve from the temp project.
      import.meta.resolve("tsx"),
      fileURLToPath(new URL("./bin.ts", import.meta.url)),
      "dev",
      "--endpoint",
      agent.endpoint,
      "--no-open",
    ],
    {
      cwd: p.context.cwd,
      env: p.context.env,
      stdio: "ignore",
    },
  );
  t.after(() => child.kill("SIGKILL"));
  const exited = once(child, "exit") as Promise<[number | null, string | null]>;

  await until(async () => (await p.descriptors()).length === 1);
  await new Promise((settle) => setTimeout(settle, 500));
  assert.equal(child.exitCode, null, "dev exited on its own");
  assert.equal((await p.descriptors()).length, 1);

  child.kill("SIGINT");
  const [code] = await exited;
  assert.equal(code, 0);
  assert.deepEqual(await p.descriptors(), []);
});
