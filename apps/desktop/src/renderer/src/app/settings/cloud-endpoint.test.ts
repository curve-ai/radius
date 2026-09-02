import assert from "node:assert/strict";
import test from "node:test";

import { cloudEndpointMessage, validateCloudEndpoint } from "./cloud-endpoint";

test("accepts https origins", () => {
  assert.equal(validateCloudEndpoint("https://api.curvehq.sh"), null);
  assert.equal(validateCloudEndpoint("  https://api.example.com  "), null);
});

test("accepts http only on loopback hosts", () => {
  assert.equal(validateCloudEndpoint("http://localhost:3100"), null);
  assert.equal(validateCloudEndpoint("http://127.0.0.1:3100"), null);
  assert.equal(validateCloudEndpoint("http://app.localhost:3300"), null);
  assert.equal(validateCloudEndpoint("http://api.example.com"), "INSECURE");
  assert.equal(
    validateCloudEndpoint("http://localhost.example.com"),
    "INSECURE",
  );
  assert.equal(validateCloudEndpoint("http://192.168.1.10:3100"), "INSECURE");
});

test("rejects empty and malformed values", () => {
  assert.equal(validateCloudEndpoint(""), "EMPTY");
  assert.equal(validateCloudEndpoint("   "), "EMPTY");
  assert.equal(validateCloudEndpoint("api.example.com"), "MALFORMED");
  assert.equal(validateCloudEndpoint("not a url"), "MALFORMED");
});

test("every error has a message", () => {
  for (const error of ["EMPTY", "MALFORMED", "INSECURE"] as const) {
    assert.ok(cloudEndpointMessage(error).length > 0);
  }
});
