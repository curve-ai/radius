import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

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
 * Writes a gzipped ustar archive directly, rather than shelling out to `tar`.
 *
 * The traversal case needs an entry literally named `../escaped`, which the
 * filesystem will not let us create and which only BSD tar can fake with -s.
 * GNU tar uses --transform and Windows tar neither — so building the bytes
 * here is the only way this test runs the same everywhere.
 */
async function tarball(
  storedName: string,
  body: string,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "radius-tar-"));
  const archive = join(root, "a.tar.gz");

  const content = Buffer.from(body, "utf8");
  const header = Buffer.alloc(512);
  header.write(storedName, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "utf8"); // mode
  header.write("0000000\0", 108, 8, "utf8"); // uid
  header.write("0000000\0", 116, 8, "utf8"); // gid
  header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124, 12, "utf8");
  header.write(`${(0).toString(8).padStart(11, "0")}\0`, 136, 12, "utf8"); // mtime
  header.write("        ", 148, 8, "utf8"); // checksum placeholder: spaces
  header.write("0", 156, 1, "utf8"); // typeflag: regular file
  header.write("ustar\0", 257, 6, "utf8");
  header.write("00", 263, 2, "utf8");

  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "utf8");

  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  const trailer = Buffer.alloc(1024); // two empty blocks end the archive
  await writeFile(
    archive,
    gzipSync(Buffer.concat([header, content, padding, trailer])),
  );
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
  const archive = await tarball("../escaped", "owned\n");
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
