import assert from "node:assert/strict";
import test from "node:test";

import { schemaSha256, validateConnectorEndpoint } from "./index.js";

test("canonicalizes schemas before hashing", () => {
  assert.equal(
    schemaSha256({ type: "object", properties: { b: {}, a: {} } }),
    schemaSha256({ properties: { a: {}, b: {} }, type: "object" }),
  );
});

test("requires HTTPS except for explicit loopback development", () => {
  assert.equal(
    validateConnectorEndpoint("http://127.0.0.1:3100/mcp").hostname,
    "127.0.0.1",
  );
  assert.throws(
    () => validateConnectorEndpoint("http://example.com/mcp"),
    /CONNECTOR_ENDPOINT_MUST_USE_HTTPS/,
  );
});
