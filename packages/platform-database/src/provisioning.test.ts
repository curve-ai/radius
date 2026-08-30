import assert from "node:assert/strict";
import test from "node:test";

import { stableUuid } from "./provisioning.js";

test("Platform provisioning identifiers are stable and namespace-separated", () => {
  const organization = stableUuid("organization", "auth-org-1");
  assert.equal(organization, stableUuid("organization", "auth-org-1"));
  assert.notEqual(organization, stableUuid("account", "auth-org-1"));
  assert.match(
    organization,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});
