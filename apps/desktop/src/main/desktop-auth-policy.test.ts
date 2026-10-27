import assert from "node:assert/strict";
import test from "node:test";
import type { NativeAuthorizationResponse } from "@curve-ai/platform-contracts";
import {
  assertProfileIdentity,
  assertUsableDesktopSession,
} from "./desktop-auth-policy";

test("an existing company profile cannot change account ownership", () => {
  assert.doesNotThrow(() => assertProfileIdentity(null, "first"));
  assert.doesNotThrow(() => assertProfileIdentity("first", "first"));
  assert.throws(
    () => assertProfileIdentity("first", "second"),
    /AUTH_PROFILE_MISMATCH/,
  );
});
test("workspace access requires both current platform and agent credentials", () => {
  const now = Date.now();
  const credentials = {
    platformExpiresAt: new Date(now + 60000).toISOString(),
    agent: { expiresAt: new Date(now + 60000).toISOString() },
  } as NativeAuthorizationResponse;
  assert.doesNotThrow(() =>
    assertUsableDesktopSession("ready", credentials, now),
  );
  for (const state of [
    "checking",
    "signed-out",
    "preparing",
    "awaiting-browser",
    "error",
  ])
    assert.throws(() => assertUsableDesktopSession(state, credentials, now));
  assert.throws(() => assertUsableDesktopSession("ready", null, now));
  assert.throws(() =>
    assertUsableDesktopSession(
      "ready",
      { ...credentials, platformExpiresAt: new Date(now).toISOString() },
      now,
    ),
  );
  assert.throws(() =>
    assertUsableDesktopSession(
      "ready",
      { ...credentials, agent: { ...credentials.agent, expiresAt: "invalid" } },
      now,
    ),
  );
});
