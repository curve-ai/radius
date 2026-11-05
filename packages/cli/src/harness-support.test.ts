import assert from "node:assert/strict";
import { test } from "node:test";

import { HarnessRuntimeConfigSchema } from "@curve-ai/agent-contracts";

import {
  describeUnsupported,
  HARNESS_SUPPORT,
  isSupported,
  resolveEntry,
  type HarnessSupport,
} from "./harness-support.js";
import { versionOf } from "./lock.js";

const opencode = HARNESS_SUPPORT.get("opencode")!;

function listed(id: string, version: string | undefined) {
  return {
    id,
    ...(version ? { version } : {}),
    distribution: { npx: { package: `${id}@${version ?? "1.0.0"}` } },
  };
}

function registry(...agents: object[]) {
  return { agents };
}

test("the supported range admits 1.x releases and nothing else", () => {
  for (const version of ["1.0.0", "1.18.31", "1.19.4", "1.19.5", "1.100.0"]) {
    assert.equal(isSupported(opencode, version), true, version);
  }
  for (const version of [
    "0.9.0",
    "0.0.0",
    "2.0.0",
    "2.2.5",
    "10.0.0",
    "2.0.0-beta.1",
    "1.20.0-beta.1",
    "latest",
    "",
  ]) {
    assert.equal(isSupported(opencode, version), false, version);
  }
});

test("a declared pin is complete, verifiable and inside its own range", () => {
  for (const [id, support] of HARNESS_SUPPORT) {
    const pinned = support.pinned;
    if (!pinned) continue;
    assert.equal(pinned.id, id);
    assert.equal(isSupported(support, pinned.version), true, pinned.version);
    assert.equal(versionOf(pinned.distribution), pinned.version);

    // The contract `radius.lock` and `radius.json` are held to.
    HarnessRuntimeConfigSchema.parse({
      kind: "harness",
      registryId: id,
      distribution: pinned.distribution,
    });

    assert.equal(pinned.distribution.kind, "binary");
    if (pinned.distribution.kind !== "binary") continue;
    const platforms = pinned.distribution.platforms;
    // What `radius build` needs on each kind of machine.
    assert.ok(platforms["linux/arm64"], "linux/arm64");
    assert.ok(platforms["linux/amd64"], "linux/amd64");
    for (const [platform, artifact] of Object.entries(platforms)) {
      assert.match(artifact.sha256 ?? "", /^[a-f0-9]{64}$/, platform);
      assert.ok(artifact.archive.startsWith("https://"), platform);
    }
    assert.deepEqual(
      new Set(Object.values(platforms).map((artifact) => artifact.sha256)).size,
      Object.keys(platforms).length,
      "every platform has its own digest",
    );
  }
});

test("the registry's version is used when it is supported", () => {
  const { entry, note } = resolveEntry(
    registry(listed("opencode", "1.20.0")),
    "opencode",
  );
  assert.equal(entry.version, "1.20.0");
  assert.equal(entry.distribution.kind, "npx");
  assert.equal(note, undefined);
});

test("an in-range registry entry older than the carried pin loses to it", () => {
  const { entry } = resolveEntry(
    registry(listed("opencode", "1.18.0")),
    "opencode",
  );
  assert.equal(entry, opencode.pinned);
});

test("an unsupported registry version pins the carried version, and says why", () => {
  const { entry, note } = resolveEntry(
    registry(listed("opencode", "2.2.5")),
    "opencode",
  );
  assert.equal(entry, opencode.pinned);
  assert.match(note ?? "", /offers opencode 2\.2\.5/);
  assert.match(note ?? "", /1\.19\.4 was pinned instead/);
  assert.match(note ?? "", /No tool named/);
});

test("an unsupported registry entry need not be installable to be passed over", () => {
  const { entry } = resolveEntry(
    registry({ id: "opencode", version: "2.2.5" }),
    "opencode",
  );
  assert.equal(entry, opencode.pinned);
});

test("a registry entry with no version is not assumed to be supported", () => {
  const { entry } = resolveEntry(
    registry(listed("opencode", undefined)),
    "opencode",
  );
  assert.equal(entry, opencode.pinned);
});

test("no supported version to pin is an error with a next action, not a fallback", () => {
  const table = new Map<string, HarnessSupport>([
    [
      "sample",
      {
        from: "1.0.0",
        before: "2.0.0",
        range: "1.x",
        reason: "2.x removed the thing.",
      },
    ],
  ]);
  assert.throws(
    () => resolveEntry(registry(listed("sample", "2.0.0")), "sample", table),
    (error: Error & { nextAction?: string }) =>
      /offers sample 2\.0\.0/.test(error.message) &&
      /2\.x removed the thing/.test(error.message) &&
      /Update the Radius CLI/.test(error.nextAction ?? ""),
  );
  // In range, the same table has nothing to object to.
  assert.equal(
    resolveEntry(registry(listed("sample", "1.2.3")), "sample", table).entry
      .version,
    "1.2.3",
  );
});

test("a harness with no declared range takes whatever the registry offers", () => {
  const { entry, note } = resolveEntry(
    registry(listed("goose", "99.0.0-rc.1")),
    "goose",
  );
  assert.equal(entry.version, "99.0.0-rc.1");
  assert.equal(note, undefined);
  assert.equal(describeUnsupported("goose", "99.0.0-rc.1"), undefined);
});

test("a harness the registry does not list is still reported as missing", () => {
  assert.throws(
    () => resolveEntry(registry(listed("goose", "1.0.0")), "opencode"),
    /No harness "opencode"/,
  );
});

test("describeUnsupported names the version and the reason, and passes supported pins", () => {
  assert.match(
    describeUnsupported("opencode", "2.2.5") ?? "",
    /opencode 2\.2\.5 is not a version Radius supports \(1\.x\).*No tool named/,
  );
  assert.equal(describeUnsupported("opencode", "1.19.4"), undefined);
});
