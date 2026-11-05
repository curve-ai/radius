import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePlatforms } from "./commands/build/run.js";

test("with no --platform, only this machine's own image is built", () => {
  assert.deepEqual(parsePlatforms(undefined, "linux/arm64"), ["linux/arm64"]);
  assert.deepEqual(parsePlatforms(undefined, "linux/amd64"), ["linux/amd64"]);
});

test("all builds both, so one Mac build serves Mac and Windows apps", () => {
  assert.deepEqual(parsePlatforms("all", "linux/arm64"), [
    "linux/arm64",
    "linux/amd64",
  ]);
});

test("a list is built in the order given, once each", () => {
  assert.deepEqual(
    parsePlatforms(" linux/amd64, linux/arm64,linux/amd64 ", "linux/arm64"),
    ["linux/amd64", "linux/arm64"],
  );
});

test("an unknown or empty platform is a usage error naming the choices", () => {
  assert.throws(
    () => parsePlatforms("windows/amd64", "linux/arm64"),
    /--platform windows\/amd64 is not a platform Radius builds.*linux\/arm64, linux\/amd64 or all/,
  );
  assert.throws(() => parsePlatforms(" , ", "linux/arm64"), /at least one/);
});
