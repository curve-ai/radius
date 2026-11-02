import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_HARNESS_VERSION, selectEntry } from "./registry.js";

test("a registry entry with no version still installs, under the default version", () => {
  const entry = selectEntry(
    {
      version: "1",
      agents: [{ id: "nover", distribution: { npx: { package: "nover@1.0.0" } } }],
    },
    "nover",
  );
  assert.equal(entry.version, DEFAULT_HARNESS_VERSION);
});
