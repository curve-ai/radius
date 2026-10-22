import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { AgentConfigSchema } from "@curve-ai/agent-contracts";

import { resolveHarness } from "./harness.js";

const silent = (): void => {};

function config(platforms: Record<string, unknown>) {
  return AgentConfigSchema.parse({
    schemaVersion: 1,
    agent: "agent_testtesttest",
    name: "Test",
    runtime: {
      kind: "harness",
      distribution: { kind: "binary", cmd: "./agent", args: [], platforms },
    },
  });
}

/**
 * Builds a tarball. `storedAs` renames the entry inside the archive via tar's
 * -s, which is the only way to produce a traversal path: the filesystem will
 * not let us create a file called `../escaped` to add in the first place.
 */
async function tarball(
  name: string,
  body: string,
  storedAs?: string,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "radius-tar-"));
  const stage = join(root, "stage");
  await mkdir(stage, { recursive: true });
  await writeFile(join(stage, name), body);
  const archive = join(root, "a.tar.gz");
  const args = ["czf", archive];
  if (storedAs) args.push("-s", `|^${name}|${storedAs}|`);
  args.push("-C", stage, name);
  await new Promise<void>((settle, reject) => {
    const child = spawn("tar", args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? settle() : reject(new Error(`tar exited ${String(code)}`)),
    );
  });
  return archive;
}

test("a local archive whose digest does not match is refused", async () => {
  const archive = await tarball("agent", "#!/bin/sh\necho hi\n");
  const parsed = config({
    "darwin/arm64": { archive, sha256: "0".repeat(64) },
  });
  await assert.rejects(
    () =>
      resolveHarness(parsed, process.cwd(), { platform: "darwin", arch: "arm64" }, silent),
    /Checksum mismatch/,
    "a pinned digest that does not match must stop the harness running",
  );
});

test("a URL archive without a digest is refused by the schema", () => {
  const result = AgentConfigSchema.safeParse({
    schemaVersion: 1,
    agent: "agent_testtesttest",
    name: "Test",
    runtime: {
      kind: "harness",
      distribution: {
        kind: "binary",
        cmd: "./agent",
        args: [],
        platforms: { "darwin/arm64": { archive: "https://example.test/a.tar.gz" } },
      },
    },
  });
  assert.equal(result.success, false);
  assert.match(
    JSON.stringify(result.error?.issues ?? []),
    /must carry sha256/,
    "an unpinned remote archive must not be representable in config",
  );
});

test("an archive that escapes its directory is refused before extraction", async () => {
  const archive = await tarball("escaped", "owned\n", "../escaped");
  const parsed = config({ "darwin/arm64": { archive } });
  await assert.rejects(
    () =>
      resolveHarness(parsed, process.cwd(), { platform: "darwin", arch: "arm64" }, silent),
    /path-traversal/,
    "a traversal entry must be rejected even though the digest is unpinned",
  );
});

test("a harness with no build for this platform names what it does ship", async () => {
  const parsed = config({ "linux/amd64": { archive: "./vendor/a.tar.gz" } });
  await assert.rejects(
    () =>
      resolveHarness(parsed, process.cwd(), { platform: "darwin", arch: "arm64" }, silent),
    /publishes no build for darwin\/arm64/,
  );
});

test("npx and uvx are spawned through their own runner, with -y only for npx", async () => {
  for (const [kind, expected] of [
    ["npx", ["npx", "-y", "p@1.2.3"]],
    ["uvx", ["uvx", "p@1.2.3"]],
  ] as const) {
    const parsed = AgentConfigSchema.parse({
      schemaVersion: 1,
      agent: "agent_testtesttest",
      name: "Test",
      runtime: { kind: "harness", distribution: { kind, package: "p@1.2.3", args: [] } },
    });
    const resolved = await resolveHarness(
      parsed,
      process.cwd(),
      { platform: "darwin", arch: "arm64" },
      silent,
    );
    assert.deepEqual([...resolved.command], expected);
  }
});

