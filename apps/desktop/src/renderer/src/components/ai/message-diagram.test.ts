import assert from "node:assert/strict";
import test from "node:test";

import { mermaidSourceError } from "./message-diagram-policy";

test("accepts bounded Mermaid source without embedded configuration", () => {
  assert.equal(mermaidSourceError("flowchart LR\n  Prompt --> Response"), null);
});

test("rejects Mermaid configuration directives and oversized input", () => {
  assert.equal(
    mermaidSourceError(
      "%%{init: {'securityLevel': 'loose'}}%%\nflowchart LR\nA --> B",
    ),
    "Diagram configuration directives are not supported",
  );
  assert.equal(
    mermaidSourceError(`flowchart LR\n${"A --> B\n".repeat(501)}`),
    "Diagram is too large to render safely",
  );
});
