import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadConfigFile } from "./config.js";

async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "radius-lock-test-"));
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
  return root;
}

const distribution = {
  kind: "binary",
  cmd: "./opencode",
  args: ["acp"],
  platforms: {
    "linux/arm64": {
      archive: "https://example.invalid/opencode-linux-arm64.tar.gz",
      sha256: "a".repeat(64),
    },
    "windows/amd64": {
      archive: "https://example.invalid/opencode-windows-x64.zip",
      sha256: "b".repeat(64),
      cmd: "./opencode.exe",
      args: ["acp"],
    },
  },
};

const lock = {
  "//": "generated",
  lockfileVersion: 1,
  harness: {
    registryId: "opencode",
    version: "1.19.4",
    license: "MIT",
    licenseUrl: "https://example.invalid/LICENSE",
    distribution,
  },
};

const short = {
  $schema: "https://schemas.curve.ai/radius/agent-config/v1.json",
  agent: "agent_abcdef12",
  name: "shopfloor-agent",
  version: "0.0.0",
  harness: "opencode@1.19.4",
};

const verbose = {
  schemaVersion: 1,
  agent: "agent_abcdef12",
  version: "0.0.0",
  name: "shopfloor-agent",
  runtime: {
    kind: "harness",
    registryId: "opencode",
    distribution,
    license: "MIT",
    licenseUrl: "https://example.invalid/LICENSE",
  },
  capabilities: [],
  networkAllowlist: [],
  resources: { cpu: 2, memoryMb: 4096, diskMb: 5120 },
};

test("a short radius.json and its lock load as the verbose form does", async () => {
  // The whole point of the split: every consumer of AgentConfig sees the
  // object it always saw, byte for byte, whichever form is on disk.
  const fromShort = await loadConfigFile(
    await project({
      "radius.json": JSON.stringify(short),
      "radius.lock": JSON.stringify(lock),
    }),
  );
  const fromVerbose = await loadConfigFile(
    await project({ "radius.json": JSON.stringify(verbose) }),
  );
  assert.deepEqual(fromShort.config, fromVerbose.config);
  assert.equal(fromShort.config.runtime.kind, "harness");
  assert.equal(fromShort.deprecation, undefined);
});

test("top-level harness fields land inside runtime", async () => {
  const root = await project({
    "radius.json": JSON.stringify({
      ...short,
      include: [".opencode/", "uv.lock"],
      configRoot: "/opt/agent-home",
      toolchains: [{ kind: "python", version: "3.12", lockfile: "uv.lock" }],
      env: { OPENCODE_CONFIG: "opencode-async.json" },
    }),
    "radius.lock": JSON.stringify(lock),
  });
  const { config } = await loadConfigFile(root);
  assert.equal(config.runtime.kind, "harness");
  if (config.runtime.kind !== "harness") return;
  assert.deepEqual(config.runtime.include, [".opencode/", "uv.lock"]);
  assert.equal(config.runtime.configRoot, "/opt/agent-home");
  assert.deepEqual(config.runtime.toolchains, [
    { kind: "python", version: "3.12", lockfile: "uv.lock" },
  ]);
  assert.deepEqual(config.runtime.env, {
    OPENCODE_CONFIG: "opencode-async.json",
  });
  assert.equal(
    config.runtime.distribution.kind === "binary" &&
      config.runtime.distribution.platforms["windows/amd64"]?.cmd,
    "./opencode.exe",
  );
  assert.equal("include" in config, false);
});

test("the verbose form carries env through too", async () => {
  const root = await project({
    "radius.json": JSON.stringify({
      ...verbose,
      runtime: { ...verbose.runtime, env: { OPENCODE_CONFIG: "x.json" } },
    }),
  });
  const { config } = await loadConfigFile(root);
  assert.deepEqual(
    config.runtime.kind === "harness" ? config.runtime.env : null,
    { OPENCODE_CONFIG: "x.json" },
  );
});

test("a short radius.json without its lock says to run init", async () => {
  const root = await project({ "radius.json": JSON.stringify(short) });
  await assert.rejects(
    () => loadConfigFile(root),
    (error: Error) =>
      error.name === "UsageError" &&
      /pins opencode@1\.19\.4, but there is no radius\.lock/.test(
        error.message,
      ) &&
      /radius init/.test(error.message),
  );
});

test("a lock for another version is refused, naming both", async () => {
  const root = await project({
    "radius.json": JSON.stringify({ ...short, harness: "opencode@1.19.5" }),
    "radius.lock": JSON.stringify(lock),
  });
  await assert.rejects(
    () => loadConfigFile(root),
    (error: Error) =>
      error.name === "UsageError" &&
      /pins opencode@1\.19\.5/.test(error.message) &&
      /holds opencode@1\.19\.4/.test(error.message),
  );
});

test("a lock for another harness is refused", async () => {
  const root = await project({
    "radius.json": JSON.stringify({ ...short, harness: "goose@1.19.4" }),
    "radius.lock": JSON.stringify(lock),
  });
  await assert.rejects(() => loadConfigFile(root), /holds opencode@1\.19\.4/);
});

test("a corrupt lock is a usage error that says it can be regenerated", async () => {
  const root = await project({
    "radius.json": JSON.stringify(short),
    "radius.lock": JSON.stringify({ lockfileVersion: 1, harness: {} }),
  });
  await assert.rejects(
    () => loadConfigFile(root),
    (error: Error) =>
      error.name === "UsageError" &&
      /not a valid lock/.test(error.message) &&
      /radius init --force/.test(error.message),
  );
});

test("harness and runtime together are refused", async () => {
  const root = await project({
    "radius.json": JSON.stringify({ ...verbose, harness: "opencode@1.19.4" }),
    "radius.lock": JSON.stringify(lock),
  });
  await assert.rejects(
    () => loadConfigFile(root),
    /both `harness` and `runtime`/,
  );
});

test("a malformed pin is refused before the lock is read", async () => {
  const root = await project({
    "radius.json": JSON.stringify({ ...short, harness: "opencode" }),
  });
  await assert.rejects(() => loadConfigFile(root), /<registry id>@<version>/);
});

test("top-level include beside an inline runtime is refused, not ignored", async () => {
  // Stripped silently, it would build an image with none of the project in it.
  const root = await project({
    "radius.json": JSON.stringify({ ...verbose, include: [".opencode/"] }),
  });
  await assert.rejects(
    () => loadConfigFile(root),
    /top-level `include`, which only applies beside `harness`/,
  );
});

test("errors in the short form name the key as written", async () => {
  const root = await project({
    "radius.json": JSON.stringify({ ...short, include: ["../secrets/"] }),
    "radius.lock": JSON.stringify(lock),
  });
  await assert.rejects(
    () => loadConfigFile(root),
    (error: Error) =>
      /\n {2}include\.0: Path must not escape/.test(error.message) &&
      !/runtime\.include\.0/.test(error.message),
  );
});

test("--config reads the lock beside the named file", async () => {
  const root = await project({
    "envs/radius.json": JSON.stringify({ ...short, name: "Prod" }),
    "envs/radius.lock": JSON.stringify(lock),
  });
  const loaded = await loadConfigFile(root, join(root, "envs", "radius.json"));
  assert.equal(loaded.config.name, "Prod");
});
