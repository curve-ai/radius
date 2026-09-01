import assert from "node:assert/strict";
import test from "node:test";

import { parseSessionFileHref } from "./session-file-links";

test("parses absolute, relative, and file URL transcript links", () => {
  assert.deepEqual(parseSessionFileHref("/tmp/project/file.ts:42:7"), {
    column: 7,
    line: 42,
    path: "/tmp/project/file.ts",
  });
  assert.deepEqual(parseSessionFileHref("src/file.ts"), {
    column: null,
    line: null,
    path: "src/file.ts",
  });
  assert.deepEqual(parseSessionFileHref("file:///tmp/My%20File.md"), {
    column: null,
    line: null,
    path: "/tmp/My File.md",
  });
});

test("rejects external and malformed file targets", () => {
  assert.equal(parseSessionFileHref("https://example.com/file.ts"), null);
  assert.equal(parseSessionFileHref("javascript:alert(1)"), null);
  assert.equal(parseSessionFileHref("/tmp/file.ts:0"), null);
});
