import assert from "node:assert/strict";
import { test } from "node:test";

import { platformConnectMessage } from "./platform-errors";

test("explains a sign-in address that never showed sign-in", () => {
  const message = platformConnectMessage(
    new Error("PLATFORM_SIGN_IN_UNAVAILABLE"),
  );
  assert.match(message, /never showed a sign-in page/);
  assert.match(message, /PLATFORM_SIGN_IN_UNAVAILABLE/);
});

test("explains a cancelled sign-in", () => {
  const message = platformConnectMessage(new Error("PLATFORM_AUTH_CANCELLED"));
  assert.match(message, /did not finish/);
});

test("explains an address that is not a platform", () => {
  const message = platformConnectMessage(new Error("PLATFORM_NOT_FOUND"));
  assert.match(message, /not a Radius platform/);
});

test("explains losing organization membership", () => {
  const message = platformConnectMessage(
    new Error("SYNC_MEMBERSHIP_NOT_FOUND"),
  );
  assert.match(message, /removed from this organization/);
});

test("passes an unrecognised code through", () => {
  assert.equal(platformConnectMessage(new Error("WAT_1234")), "WAT_1234");
});

test("falls back when there is no message at all", () => {
  assert.equal(
    platformConnectMessage(new Error("")),
    "Radius could not connect to the platform",
  );
});
