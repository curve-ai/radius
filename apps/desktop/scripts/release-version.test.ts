import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compareVersions,
  nextDesktopVersion,
  withPackageVersion,
} from "./release-version";

const tags = [
  "desktop-v0.3.9",
  "desktop-v0.4.1",
  "desktop-v0.4.2-rc.1",
  "desktop-v0.10.0-beta.1",
  "runtime-host-v9.0.0",
  "desktop-vbroken",
];

test("bumps the newest stable desktop tag, not package.json", () => {
  const base = { tags, packageVersion: "0.0.1" };
  assert.equal(nextDesktopVersion({ ...base, kind: "patch" }), "0.4.2");
  assert.equal(nextDesktopVersion({ ...base, kind: "minor" }), "0.5.0");
  assert.equal(nextDesktopVersion({ ...base, kind: "major" }), "1.0.0");
});

test("starts from package.json before the first release", () => {
  assert.equal(
    nextDesktopVersion({ tags: [], packageVersion: "0.0.1", kind: "patch" }),
    "0.0.2",
  );
  assert.equal(
    nextDesktopVersion({
      tags: ["runtime-host-v1.0.0"],
      packageVersion: "0.1.0",
      kind: "minor",
    }),
    "0.2.0",
  );
});

test("accepts an explicit version only when it moves forward", () => {
  const base = { tags, packageVersion: "0.0.1", kind: "patch" as const };
  assert.equal(
    nextDesktopVersion({ ...base, explicitVersion: "0.4.5" }),
    "0.4.5",
  );
  assert.equal(
    nextDesktopVersion({ ...base, explicitVersion: "0.5.0-rc.1" }),
    "0.5.0-rc.1",
  );
  assert.throws(
    () => nextDesktopVersion({ ...base, explicitVersion: "0.4.1" }),
    /already exists/,
  );
  assert.throws(
    () => nextDesktopVersion({ ...base, explicitVersion: "0.4.0" }),
    /not newer/,
  );
  assert.throws(
    () => nextDesktopVersion({ ...base, explicitVersion: "0.4.1-rc.9" }),
    /not newer/,
  );
  assert.throws(
    () => nextDesktopVersion({ ...base, explicitVersion: "v0.5.0" }),
    /Invalid version/,
  );
});

test("refuses to cut a version whose tag already exists", () => {
  assert.throws(
    () =>
      nextDesktopVersion({
        tags: ["desktop-v1.0.0", "desktop-v1.0.1-rc.1"],
        packageVersion: "0.0.1",
        kind: "patch",
        explicitVersion: "1.0.1-rc.1",
      }),
    /already exists/,
  );
});

test("orders versions by semantic precedence", () => {
  const ordered = [
    "0.9.0",
    "0.10.0-alpha",
    "0.10.0-alpha.2",
    "0.10.0-alpha.10",
    "0.10.0-beta",
    "0.10.0",
    "1.0.0",
  ];
  assert.deepEqual([...ordered].reverse().sort(compareVersions), ordered);
});

test("rewrites only the version in package.json", () => {
  const source = `{\n  "name": "@curve-ai/radius-desktop",\n  "version": "0.0.1",\n  "dependencies": { "x": "0.0.1" }\n}\n`;
  assert.equal(
    withPackageVersion(source, "0.4.2"),
    source.replace(`"version": "0.0.1"`, `"version": "0.4.2"`),
  );
});
