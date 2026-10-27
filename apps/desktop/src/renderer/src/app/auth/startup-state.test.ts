import assert from "node:assert/strict";
import test from "node:test";
import { authenticationSurface } from "./startup-state";

test("startup never flashes the sign-in form while resolving or preparing a saved session", () => {
  for (const state of [undefined, "checking", "preparing"] as const)
    assert.equal(authenticationSurface(state), "startup");
  assert.equal(authenticationSurface("ready", false), "startup");
  assert.equal(authenticationSurface("ready"), "workspace");
  for (const state of ["signed-out", "awaiting-browser", "error"] as const)
    assert.equal(authenticationSurface(state), "sign-in");
});
