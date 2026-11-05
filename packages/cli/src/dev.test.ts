import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { WebSocket } from "ws";

import devHandler from "./commands/dev/run.js";
import type { RadiusContext } from "./context.js";
import { FAKE_ACP_AGENT } from "./test-agents.js";

interface Harnessed {
  readonly context: RadiusContext;
  readonly out: string[];
  readonly notes: string[];
  readonly userData: string;
}

/** A context whose stop is the test's to call, as Ctrl-C would. */
async function devContext(command: readonly string[]): Promise<Harnessed> {
  const cwd = await mkdtemp(join(tmpdir(), "radius-dev-project-"));
  const userData = await mkdtemp(join(tmpdir(), "radius-dev-userdata-"));
  await writeFile(
    join(cwd, "radius.json"),
    JSON.stringify({
      schemaVersion: 1,
      agent: "agent_testtesttest",
      name: "Fake",
      runtime: { kind: "command", command },
    }),
    "utf8",
  );
  const out: string[] = [];
  const notes: string[] = [];
  let release: () => void = () => {};
  const stopped = new Promise<void>((settle) => {
    release = settle;
  });
  let failed: number | null = null;
  const context = {
    process: {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      env: process.env,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
    },
    cwd,
    env: { ...process.env, RADIUS_USER_DATA_PATH: userData },
    isTTY: false,
    colour: false,
    output: "text",
    out: (message: string) => out.push(message),
    note: (message: string) => notes.push(message),
    untilStopped: () => stopped,
    stop: () => release(),
    fail: (code: number) => {
      failed = code;
    },
    failure: () => failed,
  } as unknown as RadiusContext;
  return { context, out, notes, userData };
}

function descriptors(userData: string): Promise<string[]> {
  return readdir(join(userData, "development", "agents")).catch(() => []);
}

async function until(
  condition: () => boolean | Promise<boolean>,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting: ${label}`);
    await new Promise((settle) => setTimeout(settle, 25));
  }
}

let nextId = 1;
async function pidOf(socket: WebSocket): Promise<number> {
  const id = nextId++;
  const answered = new Promise<number>((settle) => {
    const onMessage = (data: Buffer): void => {
      const message = JSON.parse(data.toString()) as {
        id?: number;
        result?: { pid?: number };
      };
      if (message.id !== id) return;
      socket.off("message", onMessage);
      settle(message.result?.pid as number);
    };
    socket.on("message", onMessage);
  });
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, method: "test/pid" }));
  return answered;
}

test(
  "dev outlives a crashed thread and keeps serving the others",
  { timeout: 30_000 },
  async () => {
    const { context, out, notes, userData } = await devContext([
      "node",
      "-e",
      FAKE_ACP_AGENT,
    ]);
    const running = devHandler.call(context, {
      verbose: false,
      "no-open": true,
      yes: false,
    });

    await until(
      async () => (await descriptors(userData)).length === 1,
      "the agent to register",
    );
    const [name] = await descriptors(userData);
    const descriptor = JSON.parse(
      await readFile(join(userData, "development", "agents", name!), "utf8"),
    ) as { endpoint: string; authorization: string };
    const headers = { Authorization: descriptor.authorization };

    const doomed = new WebSocket(descriptor.endpoint, { headers });
    const survivor = new WebSocket(descriptor.endpoint, { headers });
    await Promise.all([once(doomed, "open"), once(survivor, "open")]);
    const pid = await pidOf(survivor);

    const closed = once(doomed, "close");
    doomed.send(JSON.stringify({ jsonrpc: "2.0", method: "test/crash" }));
    await closed;

    assert.equal(await pidOf(survivor), pid, "the other thread keeps working");
    assert.equal(
      context.failure(),
      null,
      "a crashed thread is not a failed dev",
    );
    assert.equal((await descriptors(userData)).length, 1, "still registered");
    await until(
      () => notes.some((line) => /\] harness exited \(code 1\)$/.test(line)),
      "the crash to be logged",
    );
    assert.ok(
      notes.some((line) =>
        /^ {2}\[[0-9a-f]{4}\] crashing on request$/.test(line),
      ),
      "harness stderr is shown, prefixed with its connection",
    );

    assert.match(
      out[0] ?? "",
      /^✓ Fake ready in Radius {3}\(command node .*· agents: ops, reporter\)$/,
    );
    assert.ok(
      out.every((line) => !line.includes(descriptor.endpoint)),
      "the endpoint is --verbose detail",
    );

    survivor.close();
    context.stop();
    await running;
    assert.deepEqual(await descriptors(userData), [], "Ctrl-C deregisters");
  },
);

test(
  "dev refuses to register an agent that cannot complete the handshake",
  { timeout: 30_000 },
  async () => {
    const { context, userData } = await devContext([
      "node",
      "-e",
      "console.error('no key');process.exit(2)",
    ]);
    await devHandler.call(context, {
      verbose: false,
      "no-open": true,
      yes: false,
    });
    assert.equal(
      context.failure(),
      1,
      "an operational failure, per the taxonomy",
    );
    assert.deepEqual(await descriptors(userData), []);
  },
);
