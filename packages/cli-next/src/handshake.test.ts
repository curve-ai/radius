import assert from "node:assert/strict";
import { test } from "node:test";

import { OperationalError } from "./errors.js";
import { handshakeOverStdio } from "./handshake.js";
import { FAKE_ACP_AGENT, FAKE_ACP_COMMAND } from "./test-agents.js";

function options(command: readonly string[], timeoutMs?: number) {
  return { command, cwd: process.cwd(), env: process.env, timeoutMs };
}

test(
  "the handshake reports the agents a harness advertises",
  { timeout: 15_000 },
  async () => {
    const result = await handshakeOverStdio(options(FAKE_ACP_COMMAND));
    assert.equal(result.protocolVersion, 1);
    assert.deepEqual([...result.advertisedAgents], ["ops", "reporter"]);
    assert.equal(result.authRequired, false);
  },
);

test(
  "stray stdout before the first frame does not fail the handshake",
  { timeout: 15_000 },
  async () => {
    const stdout: string[] = [];
    const result = await handshakeOverStdio({
      ...options([
        "node",
        "-e",
        `process.stdout.write("booting...\\n");${FAKE_ACP_AGENT}`,
      ]),
      onStdout: (line) => stdout.push(line),
    });
    assert.equal(result.protocolVersion, 1);
    assert.deepEqual(stdout, ["booting..."]);
  },
);

test(
  "a harness that exits early fails with its last stderr",
  { timeout: 15_000 },
  async () => {
    await assert.rejects(
      () =>
        handshakeOverStdio(
          options([
            "node",
            "-e",
            "console.error('missing API key');process.exit(3)",
          ]),
        ),
      (error: unknown) =>
        error instanceof OperationalError &&
        /exited before completing the ACP handshake \(code 3/.test(
          error.message,
        ) &&
        /missing API key/.test(error.nextAction ?? ""),
    );
  },
);

test("a command that cannot be spawned is an operational error", async () => {
  await assert.rejects(
    () => handshakeOverStdio(options(["radius-test-no-such-binary"])),
    (error: unknown) =>
      error instanceof OperationalError &&
      /Could not start/.test(error.message),
  );
});

test(
  "a harness that never answers times out instead of hanging dev",
  { timeout: 15_000 },
  async () => {
    await assert.rejects(
      () =>
        handshakeOverStdio(
          options(["node", "-e", "setInterval(() => {}, 1000)"], 300),
        ),
      (error: unknown) =>
        error instanceof OperationalError &&
        /did not answer/.test(error.message),
    );
  },
);

test(
  "a harness that wants sign-in before session/new still passes",
  { timeout: 15_000 },
  async () => {
    const agent = FAKE_ACP_AGENT.replace(
      'message.method === "session/new"',
      'message.method === "session/new" && false',
    ).replace(
      'message.method === "test/pid"',
      'message.method === "session/new") { send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "auth required" } }); } else if (message.method === "test/pid"',
    );
    const result = await handshakeOverStdio(options(["node", "-e", agent]));
    assert.equal(result.authRequired, true);
  },
);
