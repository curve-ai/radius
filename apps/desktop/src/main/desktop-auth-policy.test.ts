import assert from "node:assert/strict";
import test from "node:test";
import type { NativeAuthorizationResponse } from "@curve-ai/platform-contracts";
import {
  assertBundleMatchesPlatform,
  assertProfileIdentity,
  assertUsableDesktopSession,
} from "./desktop-auth-policy";

const configuration = {
  issuer: "https://identity.example.com",
  clientId: "radius-desktop",
  redirectUri: "http://127.0.0.1:43821/callback",
  scopes: ["openid"],
  resource: "https://api.example.com/agent",
  organizationSlug: "example",
  displayName: "Example agent",
  agentId: "example-agent",
};

test("the Platform supplies identity routing for the default bundle", () => {
  assert.doesNotThrow(() => assertBundleMatchesPlatform(null, configuration));
});

test("a branded bundle still pins its organization and agent", () => {
  const distribution = {
    id: "com.example.agent",
    displayName: "Example agent",
    platformUrl: "https://radius.example.com/",
    organizationSlug: "example",
    agentId: "example-agent",
  };
  assert.doesNotThrow(() =>
    assertBundleMatchesPlatform(distribution, configuration),
  );
  assert.throws(
    () =>
      assertBundleMatchesPlatform(distribution, {
        ...configuration,
        organizationSlug: "another-company",
      }),
    /AUTH_CONFIGURATION_INVALID/,
  );
});

test("an existing desktop profile cannot change account ownership", () => {
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
