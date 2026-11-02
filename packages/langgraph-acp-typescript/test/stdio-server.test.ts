/** Drive `radius-langgraph` over real stdio with raw JSON-RPC. */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { AcpProcess, makeProject } from "./acp-client.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function project(...args: Parameters<typeof makeProject>): string {
  const made = makeProject(...args);
  cleanups.push(made.cleanup);
  return made.dir;
}

function fixture(name: string): string {
  return project({ fixture: name });
}

test("a prompt streams text, reports tools, and keeps history", async () => {
  const project = fixture("weather");
  const client = AcpProcess.start(project);
  const init = await client.initialize();
  assert.equal(init.protocolVersion, 1);
  assert.equal(init.agentInfo.name, "radius-langgraph");
  assert.equal(init.agentCapabilities.loadSession, true);

  const session = await client.newSession(project);
  const sid = session.sessionId;
  assert.equal(session.modes.currentModeId, "weather");
  assert.deepEqual(
    session.modes.availableModes.map((m: { id: string }) => m.id),
    ["weather"],
  );

  let result = await client.prompt(sid, "hello there");
  assert.equal(result.stopReason, "end_turn");
  const chunks = client.updates(sid, "agent_message_chunk");
  assert.ok(chunks.length > 1, "text should stream as several chunks");
  assert.equal(client.agentText(sid), "You have said 1 things: hello there");

  client.clear();
  result = await client.prompt(sid, "what is the weather?");
  assert.equal(result.stopReason, "end_turn");
  const [started, ...moreStarts] = client.updates(sid, "tool_call");
  assert.equal(moreStarts.length, 0);
  assert.equal(started!.title, "get_weather");
  assert.equal(started!.status, "in_progress");
  assert.deepEqual(started!.rawInput, { city: "Paris" });
  const [finished, ...moreUpdates] = client.updates(sid, "tool_call_update");
  assert.equal(moreUpdates.length, 0);
  assert.equal(finished!.toolCallId, started!.toolCallId);
  assert.equal(finished!.status, "completed");
  assert.equal(finished!.content[0].content.text, "Sunny in Paris");
  assert.equal(client.agentText(sid), "Tool said: Sunny in Paris");

  client.clear();
  await client.prompt(sid, "remember me");
  assert.equal(
    client.agentText(sid),
    "You have said 3 things: hello there | what is the weather? | remember me",
  );

  const { code, stderr } = await client.close();
  assert.deepEqual(client.badLines, [], "stdout must carry only JSON-RPC");
  for (const line of client.stdoutLines) {
    assert.equal(JSON.parse(line).jsonrpc, "2.0");
  }
  assert.match(stderr, /weather graph module loaded/);
  assert.match(stderr, /agent node running/);
  assert.match(stderr, /looking up weather for Paris/);
  assert.match(stderr, /raw stdout write from a tool/);
  assert.equal(code, 0);
  assert.ok(
    existsSync(join(project, ".radius", "langgraph", "checkpoints.sqlite")),
  );
});

test("cancel stops the running turn", async () => {
  const project = fixture("weather");
  const client = AcpProcess.start(project);
  await client.initialize();
  const sid = (await client.newSession(project)).sessionId;

  const prompt = client.prompt(sid, "go slow");
  await client.waitForUpdate(sid, "tool_call");
  client.notify("session/cancel", { sessionId: sid });
  const result = await prompt;
  assert.equal(result.stopReason, "cancelled");
  assert.equal(
    client.updates(sid, "tool_call_update").at(-1)!.status,
    "failed",
  );

  client.clear();
  const next = await client.prompt(sid, "still there?");
  assert.equal(next.stopReason, "end_turn");
  assert.equal(
    client.agentText(sid),
    "You have said 2 things: go slow | still there?",
  );
  await client.close();
  assert.deepEqual(client.badLines, []);
});

test("an interrupt asks permission and resumes", async () => {
  const project = fixture("weather");
  const client = AcpProcess.start(project);
  await client.initialize();
  const sid = (await client.newSession(project)).sessionId;

  const result = await client.prompt(sid, "please deploy");
  assert.equal(result.stopReason, "end_turn");
  assert.equal(client.permissionRequests.length, 1);
  const [request] = client.permissionRequests;
  assert.equal(request!.toolCall.title, "Deploy to production?");
  assert.deepEqual(
    new Set(request!.options.map((o: { optionId: string }) => o.optionId)),
    new Set(["approve", "reject"]),
  );
  const [started] = client.updates(sid, "tool_call");
  assert.equal(request!.toolCall.toolCallId, started!.toolCallId);
  assert.equal(
    client.updates(sid, "tool_call_update").at(-1)!.content[0].content.text,
    "deployed",
  );
  assert.equal(client.agentText(sid), "Tool said: deployed");
  await client.close();
});

test("a cancelled permission request is answered by the next prompt", async () => {
  const project = fixture("weather");
  const client = AcpProcess.start(project);
  client.onPermission = () => ({ outcome: { outcome: "cancelled" } });
  await client.initialize();
  const sid = (await client.newSession(project)).sessionId;

  const result = await client.prompt(sid, "deploy now");
  assert.equal(result.stopReason, "cancelled");

  client.clear();
  const next = await client.prompt(sid, "yes");
  assert.equal(next.stopReason, "end_turn");
  assert.equal(client.agentText(sid), "Tool said: deployed");
  await client.close();
});

test("a client without permission support is asked in text", async () => {
  const project = fixture("weather");
  const client = AcpProcess.start(project);
  client.onPermission = () => "error";
  await client.initialize();
  const sid = (await client.newSession(project)).sessionId;

  const result = await client.prompt(sid, "deploy please");
  assert.equal(result.stopReason, "end_turn");
  assert.equal(
    client.agentText(sid),
    "The graph is waiting for input:\n- Deploy to production?\nReply to continue.",
  );

  client.clear();
  await client.prompt(sid, "no");
  assert.equal(client.agentText(sid), "Tool said: deploy rejected");
  await client.close();
});

test("session/load reuses the thread across processes", async () => {
  const project = fixture("weather");
  const first = AcpProcess.start(project);
  await first.initialize();
  const sid = (await first.newSession(project)).sessionId;
  await first.prompt(sid, "first message");
  await first.close();

  const second = AcpProcess.start(project);
  await second.initialize();
  const loaded = await second.request("session/load", {
    sessionId: sid,
    cwd: project,
    mcpServers: [],
  });
  assert.equal(loaded.modes.currentModeId, "weather");
  assert.deepEqual(
    second.updates(sid, "user_message_chunk").map((u) => u.content.text),
    ["first message"],
  );
  assert.equal(second.agentText(sid), "You have said 1 things: first message");

  second.clear();
  await second.prompt(sid, "second message");
  assert.equal(
    second.agentText(sid),
    "You have said 2 things: first message | second message",
  );
  await second.close();
});

test("each graph is a session mode", async () => {
  const project = fixture("multi");
  const client = AcpProcess.start(project);
  await client.initialize();
  const session = await client.newSession(project);
  const sid = session.sessionId;
  const modes = session.modes;
  assert.equal(modes.currentModeId, "echo");
  assert.deepEqual(
    modes.availableModes.map((m: { id: string }) => m.id),
    ["echo", "shout", "remembered", "forgetful", "count"],
  );
  assert.equal(modes.availableModes[1].description, "Shouts back");
  assert.equal(modes.availableModes[0].description, undefined);

  await client.prompt(sid, "hi");
  assert.equal(client.agentText(sid), "echo: hi");

  const cases: Array<[string, string]> = [
    ["shout", "HI"],
    ["remembered", "noted"],
    ["forgetful", "forgotten"],
    ["count", "2 characters"],
  ];
  for (const [mode, reply] of cases) {
    client.clear();
    await client.request("session/set_mode", { sessionId: sid, modeId: mode });
    const result = await client.prompt(sid, "hi");
    assert.equal(result.stopReason, "end_turn", mode);
    assert.equal(client.agentText(sid), reply, mode);
  }

  await assert.rejects(
    client.request("session/set_mode", { sessionId: sid, modeId: "nope" }),
    /availableModes/,
  );
  await client.close();
});

test("--graph serves one graph", async () => {
  const project = fixture("multi");
  const client = AcpProcess.start(project, "--graph", "shout");
  await client.initialize();
  const { modes } = await client.newSession(project);
  assert.deepEqual(
    modes.availableModes.map((m: { id: string }) => m.id),
    ["shout"],
  );
  await client.close();
});

test("a load error exits before serving", async () => {
  const dir = project({
    files: {
      "agent.mjs": "export const graph = null;\n",
      "langgraph.json": JSON.stringify({
        graphs: { broken: "./agent.mjs:missing" },
      }),
    },
  });
  const client = AcpProcess.start(dir);
  const { code, stderr } = await client.close();
  assert.notEqual(code, 0);
  assert.match(stderr, /has no export "missing"/);
  assert.deepEqual(client.stdoutLines, []);
});

test("a graph module that throws is reported", async () => {
  const dir = project({
    files: {
      "agent.ts": 'throw new Error("boom");\n',
      "langgraph.json": JSON.stringify({
        graphs: { broken: "./agent.ts:graph" },
      }),
    },
  });
  const client = AcpProcess.start(dir);
  const { code, stderr } = await client.close();
  assert.notEqual(code, 0);
  assert.match(stderr, /failed to import \.\/agent\.ts:graph: boom/);
  assert.deepEqual(client.stdoutLines, []);
});

test("an export that is not a graph is reported", async () => {
  const dir = project({
    files: {
      "agent.mjs": "export const graph = 42;\n",
      "langgraph.json": JSON.stringify({ graphs: { g: "./agent.mjs:graph" } }),
    },
  });
  const client = AcpProcess.start(dir);
  const { code, stderr } = await client.close();
  assert.notEqual(code, 0);
  assert.match(
    stderr,
    /expected a compiled graph, a StateGraph, or a factory; got number/,
  );
});

test("a missing config exits with a message", async () => {
  const dir = project({ files: {} }, { linkModules: false });
  const client = AcpProcess.start(dir, "--config", "nope/langgraph.json");
  const { code, stderr } = await client.close();
  assert.notEqual(code, 0);
  assert.match(stderr, /LangGraph config not found/);
});

test("a project without LangGraph installed is told so", async () => {
  const dir = project(
    {
      files: {
        "agent.mjs": "export const graph = {};\n",
        "langgraph.json": JSON.stringify({
          graphs: { g: "./agent.mjs:graph" },
        }),
      },
    },
    { linkModules: false },
  );
  const client = AcpProcess.start(dir);
  const { code, stderr } = await client.close();
  assert.notEqual(code, 0);
  assert.match(stderr, /cannot find @langchain\/langgraph/);
});
