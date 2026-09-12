import assert from "node:assert/strict";
import test from "node:test";
import { HOSTED_AUTH_ISSUER, resolveAuthIssuer } from "./auth-configuration.js";
import { nativeEntriesFromEnvironment } from "./native-auth.js";

const organization = {
  organizationSlug: "example",
  agentId: "example-agent",
  displayName: "Example",
  clientId: "registered-native-client",
  resource: "https://api.example.com/agent",
  redirectUri: "http://127.0.0.1:43821/callback",
  scopes: ["openid", "profile", "email"],
};

test("a provisioned organization without an issuer uses hosted Better Auth", () => {
  const entries = nativeEntriesFromEnvironment({
    RADIUS_NATIVE_AUTH_CONFIG: JSON.stringify([organization]),
  });
  assert.equal(entries[0]!.config.issuer, HOSTED_AUTH_ISSUER);
  assert.equal(entries[0]!.policy.allowUnprovisionedIdentities, false);
  assert.equal(entries[0]!.config.clientId, organization.clientId);
});

test("organization issuer overrides deployment defaults in either topology", () => {
  for (const mode of ["true", "false"]) {
    const entries = nativeEntriesFromEnvironment({
      RADIUS_PLATFORM_SHARED_ORIGINS: mode,
      RADIUS_AUTH_ISSUER: "https://default.example.com/api/auth",
      RADIUS_NATIVE_AUTH_CONFIG: JSON.stringify([
        organization,
        {
          ...organization,
          organizationSlug: "custom",
          clientId: "custom-client",
          issuer: "https://id.example.com/oidc/",
        },
      ]),
    });
    assert.equal(
      entries[0]!.config.issuer,
      "https://default.example.com/api/auth",
    );
    assert.equal(entries[1]!.config.issuer, "https://id.example.com/oidc/");
  }
});

test("invalid explicit configuration never falls back to hosted auth", () => {
  for (const issuer of [
    "",
    null,
    "http://remote.example.com",
    "https://user:secret@id.example.com",
    "https://id.example.com/#bad",
  ]) {
    assert.throws(() =>
      nativeEntriesFromEnvironment({
        RADIUS_NATIVE_AUTH_CONFIG: JSON.stringify([
          { ...organization, issuer },
        ]),
      }),
    );
  }
  assert.throws(() =>
    nativeEntriesFromEnvironment({ RADIUS_NATIVE_AUTH_CONFIG: "" }),
  );
  assert.deepEqual(
    nativeEntriesFromEnvironment({ RADIUS_NATIVE_AUTH_CONFIG: "[]" }),
    [],
  );
  assert.throws(
    () =>
      nativeEntriesFromEnvironment({
        RADIUS_NATIVE_AUTH_CONFIG: "[]",
        RADIUS_NATIVE_AUTH_CONFIG_FILE: "missing.json",
      }),
    /Set only one/,
  );
  assert.throws(
    () => nativeEntriesFromEnvironment({ RADIUS_NATIVE_CLIENT_ID: "partial" }),
    /together/,
  );
});

test("environment config uses the same resolver and requires explicit loopback opt-in", () => {
  assert.throws(() => resolveAuthIssuer("http://localhost:3400/api/auth", {}));
  assert.equal(
    resolveAuthIssuer("http://localhost:3400/api/auth", {
      RADIUS_OIDC_ALLOW_INSECURE_LOOPBACK: "true",
    }),
    "http://localhost:3400/api/auth",
  );
  const [entry] = nativeEntriesFromEnvironment({
    RADIUS_NATIVE_CLIENT_ID: organization.clientId,
    RADIUS_NATIVE_ORGANIZATION: organization.organizationSlug,
    RADIUS_NATIVE_AGENT_ID: organization.agentId,
    RADIUS_NATIVE_RESOURCE: organization.resource,
  });
  assert.equal(entry!.config.issuer, HOSTED_AUTH_ISSUER);
  assert.equal(entry!.config.redirectUri, organization.redirectUri);
  assert.deepEqual(nativeEntriesFromEnvironment({}), []);
});
