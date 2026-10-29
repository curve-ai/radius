import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { checkAgent, type CheckResult } from "./check.js";

/**
 * A stand-in ACP agent, so the check is exercised against a real process on
 * real pipes without downloading a harness or needing the network.
 *
 * Behaviour arrives as one JSON argument instead of one script per case: the
 * cases differ only in what they answer, and a single reader keeps them from
 * drifting apart in how they frame it.
 */
const FAKE_AGENT = `
const behaviour = JSON.parse(process.argv[2]);
for (const line of behaviour.junk ?? []) process.stdout.write(line + "\\n");
if (behaviour.stderr) process.stderr.write(behaviour.stderr + "\\n");
if (behaviour.exitCode !== undefined) process.exit(behaviour.exitCode);
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\\n")) !== -1) {
    const message = JSON.parse(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
    if (behaviour.hang) continue;
    const result =
      message.method === "initialize" ? behaviour.initialize
      : message.method === "session/new" ? behaviour.session
      : undefined;
    if (result !== undefined) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
    }
  }
});
`;

const OPENCODE_INIT = {
  protocolVersion: 1,
  agentCapabilities: {},
  authMethods: [],
  agentInfo: { name: "OpenCode", version: "1.19.4" },
};

/** The shape opencode 1.19 actually answers with: agents as a `mode` select. */
function opencodeSession(agents: string[]) {
  return {
    sessionId: "ses_test",
    configOptions: [
      {
        id: "model",
        category: "model",
        type: "select",
        currentValue: "anthropic/ops",
        options: [{ value: "anthropic/ops", name: "ops" }],
      },
      {
        id: "mode",
        name: "Session Mode",
        category: "mode",
        type: "select",
        currentValue: agents[0],
        options: agents.map((value) => ({ value, name: value })),
      },
    ],
  };
}

async function fixture(): Promise<{ root: string; script: string }> {
  const root = await mkdtemp(join(tmpdir(), "radius-check-"));
  // Shopfloor's layout in miniature: one primary agent, one subagent, and a
  // config that switches the built-ins off.
  await mkdir(join(root, ".opencode", "agent"), { recursive: true });
  await writeFile(
    join(root, ".opencode", "agent", "ops.md"),
    "---\ndescription: Plant ops\nmode: primary\n---\nYou run the plant.\n",
  );
  await writeFile(
    join(root, ".opencode", "agent", "reporter.md"),
    "---\ndescription: Reports\nmode: subagent\n---\nYou report.\n",
  );
  await writeFile(
    join(root, "opencode.json"),
    JSON.stringify({
      agent: { plan: { disable: true }, build: { disable: true } },
    }),
  );
  const script = join(root, "fake-agent.mjs");
  await writeFile(script, FAKE_AGENT);
  return { root, script };
}

async function check(
  behaviour: Record<string, unknown>,
  timeoutMs = 5000,
): Promise<CheckResult> {
  const { root, script } = await fixture();
  return checkAgent({
    command: [process.execPath, script, JSON.stringify(behaviour)],
    root,
    env: process.env,
    timeoutMs,
  });
}

function verdict(result: CheckResult, id: string) {
  const found = result.verdicts.find((candidate) => candidate.id === id);
  assert.ok(found, `no ${id} verdict`);
  return found;
}

test("an agent that advertises the project's own agent passes", async () => {
  const result = await check({
    initialize: OPENCODE_INIT,
    session: opencodeSession(["ops"]),
  });
  assert.equal(result.passed, true, JSON.stringify(result.verdicts, null, 2));
  assert.equal(result.protocolVersion, 1);
  assert.deepEqual(result.advertisedAgents, ["ops"]);
  assert.equal(verdict(result, "agents").status, "pass");
  assert.match(
    verdict(result, "handshake").summary,
    /ACP v1 — OpenCode 1\.19\.4/,
  );
});

test("a harness serving only its built-ins fails even though it handshakes", async () => {
  const result = await check({
    initialize: OPENCODE_INIT,
    session: opencodeSession(["build", "plan"]),
  });
  assert.equal(result.passed, false);
  assert.equal(verdict(result, "handshake").status, "pass");
  const agents = verdict(result, "agents");
  assert.equal(agents.status, "fail");
  assert.match(agents.summary, /only opencode's built-in agents/);
  assert.ok(agents.detail.some((line) => /expected\s+ops/.test(line)));
});

test("the stock deepagents-acp bin is recognised as a stranger by its identity", async () => {
  const result = await check({
    initialize: {
      protocolVersion: 1,
      agentInfo: { name: "deepagents-acp", version: "0.1.7" },
    },
    // The same three modes deepagents-acp offers for every agent it serves,
    // which is why they cannot be the evidence.
    session: {
      sessionId: "s",
      modes: {
        currentModeId: "agent",
        availableModes: [{ id: "agent" }, { id: "plan" }, { id: "ask" }],
      },
    },
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.advertisedAgents, ["agent", "plan", "ask"]);
  assert.match(
    verdict(result, "agents").summary,
    /deepagents-acp's generic agent/,
  );
});

test("non-JSON output on stdout fails the check and is quoted back", async () => {
  const result = await check({
    junk: ["Starting server…", "listening on stdio"],
    initialize: OPENCODE_INIT,
    session: opencodeSession(["ops"]),
  });
  assert.equal(result.passed, false);
  // The handshake itself still succeeded: a lenient bridge would have hidden
  // this, which is exactly why it is reported on its own.
  assert.equal(verdict(result, "handshake").status, "pass");
  const stdout = verdict(result, "stdout");
  assert.equal(stdout.status, "fail");
  assert.deepEqual(result.probe.stdoutNoise, [
    "Starting server…",
    "listening on stdio",
  ]);
  assert.ok(stdout.detail.some((line) => line.includes("Starting server…")));
});

test("an agent that never answers times out with its stderr attached", async () => {
  const started = Date.now();
  const result = await check({ hang: true, stderr: "booting plugins" }, 400);
  assert.equal(result.passed, false);
  assert.equal(result.probe.failure?.kind, "timeout");
  assert.equal(result.probe.stage, "initialize");
  const handshake = verdict(result, "handshake");
  assert.match(handshake.summary, /no answer to initialize/);
  assert.ok(handshake.detail.some((line) => line.includes("booting plugins")));
  assert.equal(verdict(result, "agents").status, "skip");
  assert.ok(Date.now() - started < 4000, "the hung agent must be killed");
});

test("an agent that exits before answering reports the exit and stderr", async () => {
  const result = await check({
    exitCode: 3,
    stderr: "missing ANTHROPIC_API_KEY",
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.probe.failure, {
    kind: "exit",
    code: 3,
    signal: null,
  });
  const handshake = verdict(result, "handshake");
  assert.match(handshake.summary, /exited during initialize \(code 3\)/);
  assert.ok(
    handshake.detail.some((line) => line.includes("ANTHROPIC_API_KEY")),
  );
});

test("a command that cannot start is a failed check, not a crash", async () => {
  const { root } = await fixture();
  const result = await checkAgent({
    command: [join(root, "does-not-exist")],
    root,
    env: process.env,
    timeoutMs: 2000,
  });
  assert.equal(result.passed, false);
  assert.equal(result.probe.failure?.kind, "spawn");
});
