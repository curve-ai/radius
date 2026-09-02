import assert from "node:assert/strict";
import test from "node:test";

import { cloudConnectMessage } from "./cloud-errors";

test("explains a wrong sign-in address rather than blaming the user", () => {
  const message = cloudConnectMessage(
    new Error("CLOUD_AUTH_SIGN_IN_UNAVAILABLE"),
  );
  assert.match(message, /sign-in address/i);
  assert.match(message, /CLOUD_AUTH_SIGN_IN_UNAVAILABLE/);
});

test("cancellation reads as unfinished, not deliberate", () => {
  const message = cloudConnectMessage(new Error("CLOUD_AUTH_CANCELLED"));
  assert.match(message, /did not finish/i);
  assert.match(message, /CLOUD_AUTH_CANCELLED/);
});

test("keeps the raw code for unknown failures", () => {
  assert.equal(cloudConnectMessage(new Error("WAT_1234")), "WAT_1234");
});

test("falls back when there is no message", () => {
  assert.equal(
    cloudConnectMessage(new Error("")),
    "Radius could not connect to the server",
  );
});
