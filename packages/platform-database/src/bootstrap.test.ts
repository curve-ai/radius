import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBootstrapOptions } from "./bootstrap.js";

test("normalizes a valid initial owner bootstrap", () => {
  assert.deepEqual(
    normalizeBootstrapOptions({
      organizationSlug: " Acme-Engineering ",
      organizationDisplayName: " Acme Engineering ",
      accountDisplayName: " Platform Owner ",
    }),
    {
      organizationSlug: "acme-engineering",
      organizationDisplayName: "Acme Engineering",
      accountDisplayName: "Platform Owner",
      tokenLabel: "Initial owner",
    },
  );
});

test("rejects invalid slugs and empty labels before opening a transaction", () => {
  assert.throws(
    () =>
      normalizeBootstrapOptions({
        organizationSlug: "9-invalid",
        organizationDisplayName: "Organization",
        accountDisplayName: "Owner",
      }),
    /Organization slug/,
  );
  assert.throws(
    () =>
      normalizeBootstrapOptions({
        organizationSlug: "valid",
        organizationDisplayName: "Organization",
        accountDisplayName: "Owner",
        tokenLabel: " ",
      }),
    /Token label/,
  );
});
