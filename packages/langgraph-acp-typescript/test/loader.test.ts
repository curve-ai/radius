import { MemorySaver } from "@langchain/langgraph";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { resumeFromText } from "../src/agent.ts";
import { ConfigError, applyEnv, loadConfig } from "../src/config.ts";
import {
  GraphLoadError,
  attachCheckpointers,
  loadGraphs,
  parseGraphSpec,
  type LoadedGraph,
} from "../src/loader.ts";
import { loadProjectLibraries, resolvePackage } from "../src/project.ts";
import { makeProject } from "./acp-client.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function fixture(name: string): string {
  const made = makeProject({ fixture: name });
  cleanups.push(made.cleanup);
  return made.dir;
}

async function loadMulti(): Promise<{
  dir: string;
  graphs: Record<string, LoadedGraph>;
  warnings: string[];
  kind: string | undefined;
}> {
  const dir = fixture("multi");
  const config = loadConfig(join(dir, "langgraph.json"));
  const libraries = await loadProjectLibraries(config.root);
  const loaded = await loadGraphs(config);
  const warnings: string[] = [];
  const checkpointing = await attachCheckpointers(
    loaded,
    dir,
    libraries,
    (message) => warnings.push(message),
  );
  cleanups.unshift(() => checkpointing?.close());
  return {
    dir,
    graphs: Object.fromEntries(loaded.map((g) => [g.name, g])),
    warnings,
    kind: checkpointing?.kind,
  };
}

test("graphs without a checkpointer share one SQLite saver", async () => {
  const { dir, graphs, warnings, kind } = await loadMulti();
  assert.equal(kind, "sqlite");
  assert.deepEqual(warnings, []);
  const saver = graphs.echo!.graph.checkpointer as object;
  assert.equal(saver.constructor.name, "SqliteSaver");
  assert.equal(graphs.shout!.graph.checkpointer, saver);
  assert.equal(graphs.count!.graph.checkpointer, saver);
  assert.ok(
    existsSync(join(dir, ".radius", "langgraph", "checkpoints.sqlite")),
  );
});

test("an existing checkpointer is kept and false stays disabled", async () => {
  const { graphs } = await loadMulti();
  assert.ok(graphs.remembered!.graph.checkpointer instanceof MemorySaver);
  assert.equal(graphs.forgetful!.graph.checkpointer, false);
  assert.equal(graphs.shout!.description, "Shouts back");
});

test("an unusable SQLite file falls back to memory with a warning", async () => {
  const dir = fixture("multi");
  // A file where the directory should be makes the SQLite saver unusable,
  // as a missing native build does.
  writeFileSync(join(dir, ".radius"), "");
  const config = loadConfig(join(dir, "langgraph.json"));
  const libraries = await loadProjectLibraries(config.root);
  const loaded = await loadGraphs(config, { only: "echo" });
  const warnings: string[] = [];
  const checkpointing = await attachCheckpointers(
    loaded,
    dir,
    libraries,
    (message) => warnings.push(message),
  );
  assert.equal(checkpointing?.kind, "memory");
  assert.ok(loaded[0]!.graph.checkpointer instanceof MemorySaver);
  assert.match(warnings.join("\n"), /SQLite checkpointer is unavailable/);
});

test("an unknown graph name is rejected", async () => {
  const dir = fixture("multi");
  const config = loadConfig(join(dir, "langgraph.json"));
  await assert.rejects(
    loadGraphs(config, { only: "nope" }),
    (error: unknown) =>
      error instanceof GraphLoadError && /graph "nope"/.test(error.message),
  );
});

test("graph references follow the LangGraph JS CLI", () => {
  assert.deepEqual(parseGraphSpec("./src/agent.ts:graph"), {
    file: "./src/agent.ts",
    name: "graph",
  });
  assert.deepEqual(parseGraphSpec("./src/agent.mjs"), {
    file: "./src/agent.mjs",
    name: "default",
  });
  assert.deepEqual(parseGraphSpec("C:\\work\\agent.js:graph"), {
    file: "C:\\work\\agent.js",
    name: "graph",
  });
  assert.throws(() => parseGraphSpec("my_agent.graph:graph"), GraphLoadError);
  assert.throws(() => parseGraphSpec("./agent.py:graph"), GraphLoadError);
});

test("the config requires graphs", () => {
  const dir = fixture("multi");
  writeFileSync(join(dir, "langgraph.json"), '{"graphs": {}}');
  assert.throws(
    () => loadConfig(join(dir, "langgraph.json")),
    (error: unknown) =>
      error instanceof ConfigError && /non-empty/.test(error.message),
  );
});

test("an env file is loaded without overriding", () => {
  const dir = fixture("multi");
  writeFileSync(join(dir, ".env"), '# comment\nexport RL_A="one"\nRL_B=two\n');
  writeFileSync(
    join(dir, "langgraph.json"),
    '{"graphs": {"g": "./g.ts:g"}, "env": ".env"}',
  );
  delete process.env.RL_A;
  process.env.RL_B = "kept";
  try {
    applyEnv(loadConfig(join(dir, "langgraph.json")));
    assert.equal(process.env.RL_A, "one");
    assert.equal(process.env.RL_B, "kept");
  } finally {
    delete process.env.RL_A;
    delete process.env.RL_B;
  }
});

test("project packages resolve to their ESM entry", () => {
  const dir = fixture("multi");
  assert.match(
    resolvePackage(dir, "@langchain/langgraph"),
    /node_modules[\\/]@langchain[\\/]langgraph[\\/]dist[\\/]index\.js$/,
  );
  assert.match(
    resolvePackage(dir, "@langchain/core/messages"),
    /[\\/]messages[\\/]index\.js$/,
  );
});

test("a text reply answers an interrupt", () => {
  assert.equal(resumeFromText({ question: "Deploy?" }, "yes"), "yes");
  assert.equal(
    resumeFromText({ options: ["Staging", "Production"] }, "production"),
    "Production",
  );
  const hitl = { actionRequests: [{ name: "deploy" }, { name: "notify" }] };
  assert.deepEqual(resumeFromText(hitl, "Approve."), {
    decisions: [{ type: "approve" }, { type: "approve" }],
  });
  assert.deepEqual(resumeFromText(hitl, "not today"), {
    decisions: [
      { type: "reject", message: "not today" },
      { type: "reject", message: "not today" },
    ],
  });
});
