import assert from "node:assert/strict";
import test from "node:test";

import {
  platformEndpointMessage,
  validatePlatformEndpoint,
} from "./platform-endpoint";

test("accepts https origins", () => {
  assert.equal(validatePlatformEndpoint("https://api.curvehq.sh"), null);
  assert.equal(validatePlatformEndpoint("  https://api.example.com  "), null);
});

test("accepts http only on loopback hosts", () => {
  assert.equal(validatePlatformEndpoint("http://localhost:3100"), null);
  assert.equal(validatePlatformEndpoint("http://127.0.0.1:3100"), null);
  assert.equal(validatePlatformEndpoint("http://app.localhost:3300"), null);
  assert.equal(validatePlatformEndpoint("http://api.example.com"), "INSECURE");
  assert.equal(
    validatePlatformEndpoint("http://localhost.example.com"),
    "INSECURE",
  );
  assert.equal(
    validatePlatformEndpoint("http://192.168.1.10:3100"),
    "INSECURE",
  );
});

test("rejects empty and malformed values", () => {
  assert.equal(validatePlatformEndpoint(""), "EMPTY");
  assert.equal(validatePlatformEndpoint("   "), "EMPTY");
  assert.equal(validatePlatformEndpoint("api.example.com"), "MALFORMED");
  assert.equal(validatePlatformEndpoint("not a url"), "MALFORMED");
});

test("every error has a message", () => {
  for (const error of ["EMPTY", "MALFORMED", "INSECURE"] as const) {
    assert.ok(platformEndpointMessage(error).length > 0);
  }
});
