import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { AgentConfigSchema } from "@curve-ai/agent-contracts";

import { UsageError } from "./errors.js";
import { resolveStartCommand, startEnvironment } from "./start-command.js";

const silent = (): void => {};

function config(runtime: Record<string, unknown>) {
  return AgentConfigSchema.parse({
    schemaVersion: 1,
    agent: "agent_testtesttest",
    name: "Test",
    runtime,
  });
}

/**
 * A PATH holding only the named stand-ins, so each case decides exactly
 * which tools exist instead of inheriting whatever the machine has.
 */
async function pathWith(...tools: string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "radius-path-"));
  for (const tool of tools) {
    const path = join(directory, tool);
    await writeFile(path, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(path, 0o755);
  }
  return directory;
}

async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "radius-start-"));
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(join(root, name, ".."), { recursive: true });
    await writeFile(join(root, name), contents, "utf8");
  }
  return root;
}

// The real platform, not a fixed one: PATH lookup splits on `;` on Windows,
// and a pretend "darwin" split the runner's `D:\...` paths at the colon.
function host(path: string) {
  return { platform: process.platform, arch: "arm64", env: { PATH: path } };
}

test("a harness keeps the runner it was published with", async () => {
  const resolved = await resolveStartCommand(
    config({
      kind: "harness",
      registryId: "example",
      distribution: { kind: "npx", package: "p@1.2.3", args: ["--acp"] },
    }),
    process.cwd(),
    host(await pathWith("npx")),
    silent,
  );
  assert.equal(resolved.kind, "harness");
  assert.deepEqual([...resolved.command], ["npx", "-y", "p@1.2.3", "--acp"]);
  assert.equal(resolved.summary, "harness example");
  assert.deepEqual(resolved.harness, { source: "npx p@1.2.3", cached: false });
});

test("a harness carries the env its config sets, over the caller's", async () => {
  const resolved = await resolveStartCommand(
    config({
      kind: "harness",
      distribution: { kind: "npx", package: "p@1.2.3" },
      env: { OPENCODE_CONFIG: "./opencode-async.json" },
    }),
    process.cwd(),
    host(await pathWith("npx")),
    silent,
  );
  assert.deepEqual(resolved.env, { OPENCODE_CONFIG: "./opencode-async.json" });
  const env = startEnvironment(resolved, {
    PATH: "/bin",
    OPENCODE_CONFIG: "./opencode.json",
  });
  assert.equal(env.OPENCODE_CONFIG, "./opencode-async.json");
  assert.equal(env.PATH, "/bin");
});

test("a harness whose runner is missing names what to install", async () => {
  await assert.rejects(
    async () =>
      resolveStartCommand(
        config({
          kind: "harness",
          distribution: { kind: "uvx", package: "p@1.2.3", args: [] },
        }),
        process.cwd(),
        host(await pathWith()),
        silent,
      ),
    (error: unknown) =>
      error instanceof UsageError &&
      /`uvx` was not found.*uv/s.test(error.message),
  );
});

test("a python agent runs its module through uv on the declared interpreter", async () => {
  const resolved = await resolveStartCommand(
    config({ kind: "python", module: "pkg.agent", python: "3.12" }),
    process.cwd(),
    host(await pathWith("uv")),
    silent,
  );
  assert.equal(resolved.kind, "python");
  assert.deepEqual(
    [...resolved.command],
    ["uv", "run", "--python", "3.12", "python", "-m", "pkg.agent"],
  );
});

test("a python agent without uv is a usage error, not a spawn failure", async () => {
  await assert.rejects(
    async () =>
      resolveStartCommand(
        config({ kind: "python", module: "pkg.agent", python: "3.12" }),
        process.cwd(),
        host(await pathWith()),
        silent,
      ),
    (error: unknown) =>
      error instanceof UsageError && /`uv` was not found/.test(error.message),
  );
});

test("a TypeScript entrypoint runs under node with the tsx loader", async () => {
  const root = await project({ "radius/agent.ts": "export {};\n" });
  const path = await pathWith("node");
  const resolved = await resolveStartCommand(
    config({ kind: "typescript", entrypoint: "radius/agent.ts" }),
    root,
    host(path),
    silent,
  );
  const [node, flag, loader, entry] = resolved.command;
  assert.equal(node, join(path, "node"));
  assert.equal(flag, "--import");
  assert.match(
    loader ?? "",
    /^file:.*tsx/,
    "a file URL, so it resolves even when the project has no tsx",
  );
  assert.equal(entry, join(root, "radius/agent.ts"));
  assert.equal(resolved.command.length, 4, "stdio mode: no --radius-dev");
});

test("a JavaScript entrypoint runs under plain node", async () => {
  const root = await project({ "agent.mjs": "\n" });
  const path = await pathWith("node");
  const resolved = await resolveStartCommand(
    config({ kind: "typescript", entrypoint: "agent.mjs" }),
    root,
    host(path),
    silent,
  );
  assert.deepEqual(
    [...resolved.command],
    [join(path, "node"), join(root, "agent.mjs")],
  );
});

test("a missing TypeScript entrypoint is reported before anything spawns", async () => {
  const root = await project({});
  await assert.rejects(
    async () =>
      resolveStartCommand(
        config({ kind: "typescript", entrypoint: "radius/agent.ts" }),
        root,
        host(await pathWith("node")),
        silent,
      ),
    (error: unknown) =>
      error instanceof UsageError && /does not exist/.test(error.message),
  );
});

test("a command runtime runs as written", async () => {
  const resolved = await resolveStartCommand(
    config({ kind: "command", command: ["my-agent", "--stdio"] }),
    process.cwd(),
    host(await pathWith("my-agent")),
    silent,
  );
  assert.equal(resolved.kind, "command");
  assert.deepEqual([...resolved.command], ["my-agent", "--stdio"]);
});

test("a command runtime may name a path inside the project", async () => {
  const root = await project({ "bin/agent": "#!/bin/sh\n" });
  await chmod(join(root, "bin/agent"), 0o755);
  const resolved = await resolveStartCommand(
    config({ kind: "command", command: ["./bin/agent"] }),
    root,
    host(await pathWith()),
    silent,
  );
  assert.deepEqual([...resolved.command], ["./bin/agent"]);
});

test("a command runtime whose executable is missing is a usage error", async () => {
  await assert.rejects(
    async () =>
      resolveStartCommand(
        config({ kind: "command", command: ["nope-not-here"] }),
        process.cwd(),
        host(await pathWith()),
        silent,
      ),
    (error: unknown) =>
      error instanceof UsageError && /nope-not-here/.test(error.message),
  );
});
