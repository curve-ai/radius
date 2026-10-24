import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadConfigFile } from "./config.js";

async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "radius-build-test-"));
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
  return root;
}

const harnessConfig = {
  schemaVersion: 1,
  agent: "agent_abcdef12",
  name: "Harness Project",
  runtime: {
    kind: "harness",
    distribution: {
      kind: "binary",
      cmd: "./opencode",
      args: ["acp"],
      platforms: {
        "linux/arm64": {
          archive: "https://example.invalid/opencode.tar.gz",
          sha256: "a".repeat(64),
        },
      },
    },
  },
};

test("radius.json is preferred and reported without a deprecation", async () => {
  const root = await project({
    "radius.json": JSON.stringify(harnessConfig),
  });
  const loaded = await loadConfigFile(root);
  assert.equal(loaded.config.name, "Harness Project");
  assert.equal(loaded.deprecation, undefined);
});

test("a pyproject-only project still loads, with a deprecation", async () => {
  // This is the exact shape that made `build` unreachable: the old CLI found
  // pyproject.toml, demanded [tool.radius], and stopped.
  const root = await project({
    "pyproject.toml": [
      "[project]",
      'name = "example"',
      'version = "0.1.0"',
      "",
      "[tool.radius]",
      "schemaVersion = 1",
      'agent = "agent_abcdef12"',
      'name = "Python Project"',
      "",
      "[tool.radius.runtime]",
      'kind = "python"',
      'module = "example.agent"',
      'python = "3.12"',
    ].join("\n"),
  });
  const loaded = await loadConfigFile(root);
  assert.equal(loaded.config.name, "Python Project");
  assert.match(loaded.deprecation ?? "", /pyproject\.toml is deprecated/);
});

test("a pyproject without [tool.radius] is not mistaken for a config", async () => {
  const root = await project({
    "pyproject.toml": '[project]\nname = "just-a-python-project"\n',
    "radius.config.json": JSON.stringify(harnessConfig),
  });
  const loaded = await loadConfigFile(root);
  assert.equal(loaded.config.name, "Harness Project");
  assert.match(loaded.deprecation ?? "", /radius\.config\.json is deprecated/);
});

test("a project with no config at all says what to run", async () => {
  const root = await project({ "README.md": "# nothing here\n" });
  await assert.rejects(() => loadConfigFile(root), /No radius\.json/);
});

test("the harness defaults ship nothing and stage at the state path", async () => {
  const root = await project({
    "radius.json": JSON.stringify(harnessConfig),
  });
  const { config } = await loadConfigFile(root);
  assert.equal(config.runtime.kind, "harness");
  if (config.runtime.kind !== "harness") return;
  // A binary-only harness must behave exactly as it did before these fields
  // existed, which is what makes them safe to add.
  assert.deepEqual(config.runtime.include, []);
  assert.deepEqual(config.runtime.toolchains, []);
  assert.equal(config.runtime.configRoot, "/opt/data");
});

test("configRoot must be an absolute path", async () => {
  const root = await project({
    "radius.json": JSON.stringify({
      ...harnessConfig,
      runtime: { ...harnessConfig.runtime, configRoot: "runtime" },
    }),
  });
  await assert.rejects(
    () => loadConfigFile(root),
    /configRoot must be an absolute POSIX path/,
  );
});

test("include may not escape the project", async () => {
  const root = await project({
    "radius.json": JSON.stringify({
      ...harnessConfig,
      runtime: { ...harnessConfig.runtime, include: ["../secrets/"] },
    }),
  });
  await assert.rejects(
    () => loadConfigFile(root),
    /must not escape the project root/,
  );
});
