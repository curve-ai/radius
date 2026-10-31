import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { discoverProjectAgents, readFrontMatter } from "./project-agents.js";

async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "radius-agents-"));
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  }
  return root;
}

function agent(frontMatter: string): string {
  return `---\n${frontMatter}\n---\nPrompt.\n`;
}

test("shopfloor's layout yields ops as the one agent opencode must advertise", async () => {
  const root = await project({
    ".opencode/agent/ops.md": agent("description: Ops\nmode: primary"),
    ".opencode/agent/reporter.md": agent(
      "description: Reports\nmode: subagent",
    ),
    ".opencode/agent/handover.md": agent(
      "description: Handover\nmode: subagent\ntools:\n  shift_summary: true",
    ),
    "opencode.json": JSON.stringify({
      agent: {
        ops: { model: "anthropic/ops" },
        reporter: { model: "anthropic/ops" },
        handover: { disable: true },
        plan: { disable: true },
        build: { disable: true },
        general: { disable: true },
      },
    }),
    // Not a file opencode reads, so its agents must not leak in.
    "opencode-async.json": JSON.stringify({ agent: { async: {} } }),
  });
  assert.deepEqual(await discoverProjectAgents(root), {
    framework: "opencode",
    primary: ["ops"],
    subagents: ["reporter"],
    disabled: ["build", "general", "handover", "plan"],
    sources: [".opencode/agent", "opencode.json"],
  });
});

test("the plural directory, nested names and front-matter disable are all honoured", async () => {
  const root = await project({
    ".opencode/agents/review/strict.md": agent("mode: primary"),
    ".opencode/agents/gone.md": agent("disable: true"),
    ".opencode/agents/plain.md": "No front matter at all.\n",
  });
  const found = await discoverProjectAgents(root);
  assert.equal(found.framework, "opencode");
  if (found.framework !== "opencode") return;
  assert.deepEqual(found.primary, ["plain", "review/strict"]);
  assert.deepEqual(found.disabled, ["gone"]);
});

test("an agent declared only in opencode.jsonc counts, comments and all", async () => {
  const root = await project({
    "opencode.jsonc": `{
      // the reviewer
      "agent": { "auditor": { "mode": "primary", }, },
    }`,
  });
  const found = await discoverProjectAgents(root);
  assert.equal(found.framework, "opencode");
  if (found.framework !== "opencode") return;
  assert.deepEqual(found.primary, ["auditor"]);
});

test("langgraph.json contributes its graph names", async () => {
  const root = await project({
    "langgraph.json": JSON.stringify({
      graphs: { auditor: "./src/agent.js:graph", triage: "./src/t.js:graph" },
    }),
  });
  assert.deepEqual(await discoverProjectAgents(root), {
    framework: "langgraph",
    graphs: ["auditor", "triage"],
    sources: ["langgraph.json"],
  });
});

test("a project with no agent definitions is unknown, not empty", async () => {
  const root = await project({ "package.json": "{}" });
  assert.deepEqual(await discoverProjectAgents(root), { framework: "unknown" });
});

test("a nested disable under tools is not read as the agent's own", () => {
  assert.deepEqual(
    readFrontMatter(agent("mode: primary\ntools:\n  disable: true")),
    { mode: "primary" },
  );
});
