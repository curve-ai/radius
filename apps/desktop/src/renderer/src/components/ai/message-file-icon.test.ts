import assert from "node:assert/strict";
import test from "node:test";

import {
  messageFileIconKind,
  messageFileName,
} from "./message-file-icon-utils";

test("selects VS Code file icons from names and extensions", () => {
  assert.equal(messageFileIconKind("component.tsx"), "react");
  assert.equal(messageFileIconKind("package.json"), "npm");
  assert.equal(messageFileIconKind("tsconfig.web.json"), "tsconfig");
  assert.equal(messageFileIconKind("report.pdf"), "pdf");
  assert.equal(messageFileIconKind("unknown.radius"), "file");
});

test("extracts the linked file name without its source location", () => {
  assert.equal(messageFileName("/tmp/My%20File.ts:42:7"), "My File.ts");
});
