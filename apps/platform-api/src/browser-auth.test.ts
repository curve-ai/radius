import assert from "node:assert/strict";
import test from "node:test";

import { organizationFromManagedHost } from "./browser-auth.js";

test("resolves one exact organization label from an allowlisted HTTPS host", () => {
  assert.equal(
    organizationFromManagedHost(
      new URL("https://acme.curvehq.sh/workspace"),
      "curvehq.sh",
    ),
    "acme",
  );
  assert.throws(
    () =>
      organizationFromManagedHost(
        new URL("https://acme.other.example/workspace"),
        "curvehq.sh",
      ),
    /not allowlisted/,
  );
  assert.throws(
    () =>
      organizationFromManagedHost(
        new URL("https://nested.acme.curvehq.sh/workspace"),
        "curvehq.sh",
      ),
    /invalid/,
  );
  assert.throws(
    () =>
      organizationFromManagedHost(
        new URL("https://acme.curvehq.sh/workspace"),
        ".curvehq.sh",
      ),
    /base domain is invalid/,
  );
});

test("allows HTTP organization subdomains only for explicit localhost development", () => {
  assert.equal(
    organizationFromManagedHost(
      new URL("http://northstar.localhost/workspace"),
      "localhost",
      true,
    ),
    "northstar",
  );
  assert.throws(
    () =>
      organizationFromManagedHost(
        new URL("http://northstar.localhost/workspace"),
        "localhost",
      ),
    /must use HTTPS/,
  );
});
