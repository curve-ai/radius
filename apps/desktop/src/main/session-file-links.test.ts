import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { parseSessionFileHref } from "./session-file-links";

test("parses absolute, relative, and file URL transcript links", () => {
  const fileUrlPath = path.join(tmpdir(), "My File.md");

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
  assert.deepEqual(parseSessionFileHref(pathToFileURL(fileUrlPath).href), {
    column: null,
    line: null,
    path: fileUrlPath,
  });
});

test("rejects external and malformed file targets", () => {
  assert.equal(parseSessionFileHref("https://example.com/file.ts"), null);
  assert.equal(parseSessionFileHref("javascript:alert(1)"), null);
  assert.equal(parseSessionFileHref("/tmp/file.ts:0"), null);
});
