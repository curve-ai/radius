import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSessionRunDisclosure,
  toggleSessionRunDisclosure,
} from "./session-run-disclosure";

test("starts live runs expanded and collapses them when they complete", () => {
  assert.equal(resolveSessionRunDisclosure(true, null), true);
  assert.equal(resolveSessionRunDisclosure(false, null), false);
});

test("starts historical completed runs collapsed", () => {
  assert.equal(resolveSessionRunDisclosure(false, null), false);
});

test("preserves a user's disclosure choice when the run completes", () => {
  const closed = toggleSessionRunDisclosure(true);
  const reopened = toggleSessionRunDisclosure(closed);

  assert.equal(reopened, true);
  assert.equal(resolveSessionRunDisclosure(false, reopened), true);
});
