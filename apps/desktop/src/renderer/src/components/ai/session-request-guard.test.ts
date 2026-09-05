import assert from "node:assert/strict";
import test from "node:test";

import { createSessionRequestGuard } from "./session-request-guard";

test("invalidates older session requests when a newer request starts", () => {
  const guard = createSessionRequestGuard();
  const sessionA = guard.start();
  const sessionB = guard.start();
  assert.equal(guard.current(sessionA), false);
  assert.equal(guard.current(sessionB), true);
});

test("invalidates an in-flight request when its session is disposed", () => {
  const guard = createSessionRequestGuard();
  const request = guard.start();
  guard.invalidate();
  assert.equal(guard.current(request), false);
});
