import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DESKTOP_PLATFORM_URL,
  readDesktopPlatformUrl,
  resolveDesktopPlatformUrl,
} from "./distribution";

test("an unconfigured desktop bundle targets the local Platform", () => {
  assert.equal(readDesktopPlatformUrl(), DEFAULT_DESKTOP_PLATFORM_URL);
});

test("a desktop bundle normalizes and validates its Platform origin", () => {
  assert.equal(
    resolveDesktopPlatformUrl("https://radius.example.com/base"),
    "https://radius.example.com/base/",
  );
  assert.throws(
    () => resolveDesktopPlatformUrl("http://radius.example.com"),
    /HTTPS except on loopback/,
  );
});
