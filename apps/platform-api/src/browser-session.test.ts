import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOidcMembershipActive,
  normalizeOidcProvisioningPolicy,
} from "./browser-session.js";

test("normalizes fail-closed OIDC provisioning policy", () => {
  const policy = normalizeOidcProvisioningPolicy({
    organizationSlug: "Acme",
    role: "developer",
    allowedEmails: ["Owner@Example.com"],
    allowedEmailDomains: ["@engineering.example.com"],
  });
  assert.equal(policy.organizationSlug, "acme");
  assert.equal(policy.role, "developer");
  assert.ok(policy.allowedEmails.has("owner@example.com"));
  assert.ok(policy.allowedEmailDomains.has("engineering.example.com"));
  assert.throws(() =>
    normalizeOidcProvisioningPolicy({ organizationSlug: "acme" }),
  );
});

test("supports shared Cloud sign-in only for pre-provisioned identities", () => {
  const policy = normalizeOidcProvisioningPolicy({
    organizationSlug: "acme",
    allowUnprovisionedIdentities: false,
  });
  assert.equal(policy.allowUnprovisionedIdentities, false);
  assert.equal(policy.allowedEmails.size, 0);
  assert.equal(policy.allowedEmailDomains.size, 0);
});

test("rejects OIDC sessions for suspended and removed memberships", () => {
  assert.doesNotThrow(() => assertOidcMembershipActive("active"));
  assert.throws(() => assertOidcMembershipActive("suspended"), /not active/);
  assert.throws(() => assertOidcMembershipActive("removed"), /not active/);
});
