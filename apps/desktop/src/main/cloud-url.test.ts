import assert from "node:assert/strict";
import test from "node:test";

import { validatedCloudUrl } from "./cloud-url";

test("accepts https anywhere", () => {
  assert.equal(
    validatedCloudUrl("https://api.curvehq.sh").hostname,
    "api.curvehq.sh",
  );
});

test("accepts http on loopback hosts", () => {
  for (const value of [
    "http://localhost:3100",
    "http://127.0.0.1:3100",
    "http://[::1]:3100",
  ]) {
    assert.equal(validatedCloudUrl(value).protocol, "http:", value);
  }
});

test("accepts http on reserved .localhost subdomains", () => {
  // The Cloud web application serves sign-in only on an app host.
  assert.equal(
    validatedCloudUrl("http://app.localhost:3300").hostname,
    "app.localhost",
  );
});

test("rejects http on routable hosts", () => {
  for (const value of [
    "http://api.curvehq.sh",
    "http://192.168.1.10:3100",
    "http://localhost.example.com",
    "http://notlocalhost",
  ]) {
    assert.throws(() => validatedCloudUrl(value), /HTTPS/, value);
  }
});
