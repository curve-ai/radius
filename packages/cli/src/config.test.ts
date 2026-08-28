import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadAgentConfig } from "./config.js";

test("loads language-neutral Radius configuration from pyproject.toml", async () => {
  const root = await mkdtemp(join(tmpdir(), "radius-python-config-"));
  await writeFile(
    join(root, "pyproject.toml"),
    `[project]
name = "example"

[tool.radius]
schemaVersion = 1
agent = "agent_python1"
name = "Python Example"
capabilities = []
networkAllowlist = []

[tool.radius.runtime]
kind = "python"
module = "example.agent"
python = "3.12"
lockfile = "uv.lock"
`,
  );

  const loaded = await loadAgentConfig(root);
  assert.equal(loaded.path, join(root, "pyproject.toml"));
  assert.equal(loaded.config.agent, "agent_python1");
  assert.equal(loaded.config.runtime.kind, "python");
  if (loaded.config.runtime.kind === "python") {
    assert.equal(loaded.config.runtime.module, "example.agent");
  }
});
