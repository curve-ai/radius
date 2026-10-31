import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { DEVELOPMENT_AGENT_SCHEMA_VERSIONS } from "@curve-ai/radius-runtime";

import {
  compareVersions,
  desktopTarget,
  parseDesktopRelease,
  PINNED_DESKTOP_RELEASE,
} from "./desktop-release.js";
import { WRITTEN_AGENT_SCHEMA_VERSION } from "./registration.js";

const native = async () => false;
const translated = async () => true;

test("Apple Silicon gets the arm64 build", async () => {
  const target = await desktopTarget(
    { platform: "darwin", arch: "arm64" },
    PINNED_DESKTOP_RELEASE,
    native,
  );
  assert.equal(target.supported, true);
  assert.equal(target.supported && target.key, "darwin/arm64");
});

test("an x64 Node under Rosetta is still on Apple Silicon", async () => {
  const target = await desktopTarget(
    { platform: "darwin", arch: "x64" },
    PINNED_DESKTOP_RELEASE,
    translated,
  );
  assert.equal(target.supported && target.key, "darwin/arm64");
});

test("an Intel Mac is told there is no build for it", async () => {
  const target = await desktopTarget(
    { platform: "darwin", arch: "x64" },
    PINNED_DESKTOP_RELEASE,
    native,
  );
  assert.equal(target.supported, false);
  assert.match(
    !target.supported ? target.reason : "",
    /no build for Intel Macs.*Apple Silicon/,
  );
});

for (const [platform, name] of [
  ["win32", "Windows"],
  ["linux", "Linux"],
] as const) {
  test(`${name} is not installable from the CLI yet, and says where to get it`, async () => {
    const target = await desktopTarget(
      { platform, arch: "x64" },
      PINNED_DESKTOP_RELEASE,
      native,
    );
    assert.equal(target.supported, false);
    assert.equal(
      !target.supported && target.reason,
      `Installing the desktop app from the CLI isn't supported on ${name} yet; install it from https://github.com/curve-ai/radius/releases/tag/desktop-v0.1.0`,
    );
  });
}

test("the pin parses under the manifest mirror", () => {
  assert.deepEqual(
    parseDesktopRelease(PINNED_DESKTOP_RELEASE),
    PINNED_DESKTOP_RELEASE,
  );
});

test("a manifest with a field this CLI does not know still reads", () => {
  const parsed = parseDesktopRelease({
    ...PINNED_DESKTOP_RELEASE,
    releasedAt: "2026-10-01",
  });
  assert.equal(parsed.version, "0.1.0");
});

/**
 * The publisher's schema is the source of truth; this catches the mirror
 * drifting from it on the fields the CLI relies on.
 */
test("the mirror requires what the publisher's schema requires", async () => {
  let schema: {
    required: string[];
    $defs: { artifact: { required: string[] } };
  };
  try {
    schema = JSON.parse(
      await readFile(
        join(
          import.meta.dirname,
          "..",
          "..",
          "..",
          "apps",
          "desktop",
          "scripts",
          "release-manifest.schema.json",
        ),
        "utf8",
      ),
    );
  } catch {
    // Not a checkout; nothing to compare against.
    return;
  }
  assert.deepEqual(schema.required, [
    "version",
    "agentNoteVersions",
    "platforms",
  ]);
  assert.deepEqual(schema.$defs.artifact.required, ["url", "sha256", "size"]);
  for (const field of schema.required) {
    const partial: Record<string, unknown> = { ...PINNED_DESKTOP_RELEASE };
    delete partial[field];
    assert.throws(
      () => parseDesktopRelease(partial),
      Error,
      `${field} is required`,
    );
  }
});

test("the pinned app reads the descriptors this CLI writes", () => {
  assert.ok(
    DEVELOPMENT_AGENT_SCHEMA_VERSIONS.includes(WRITTEN_AGENT_SCHEMA_VERSION),
  );
  assert.ok(
    PINNED_DESKTOP_RELEASE.agentNoteVersions.includes(
      WRITTEN_AGENT_SCHEMA_VERSION,
    ),
  );
});

test("versions order numerically, with a pre-release before its release", () => {
  assert.ok(compareVersions("0.1.0", "0.2.0") < 0);
  assert.ok(compareVersions("0.10.0", "0.9.0") > 0);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.ok(compareVersions("1.0.0-rc.1", "1.0.0") < 0);
  assert.ok(compareVersions("1.0.0", "1.0.0-rc.1") > 0);
});
