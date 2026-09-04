import assert from "node:assert/strict";
import { test } from "node:test";

import {
  platformBaseFromEndpoint,
  platformSyncEndpoint,
  platformUrl,
  validatedPlatformUrl,
} from "./platform-endpoint";

test("accepts HTTPS platform addresses", () => {
  assert.equal(
    validatedPlatformUrl("https://northwind.curvehq.sh").toString(),
    "https://northwind.curvehq.sh/",
  );
});

test("accepts plain HTTP only on loopback hosts", () => {
  assert.equal(
    validatedPlatformUrl("http://127.0.0.1:3122").toString(),
    "http://127.0.0.1:3122/",
  );
  // RFC 6761 reserves `.localhost` for loopback, so the managed dev stack at
  // `<slug>.localhost` is as local as `localhost` itself.
  assert.equal(
    validatedPlatformUrl("http://northwind.localhost:8080").toString(),
    "http://northwind.localhost:8080/",
  );
  assert.throws(() => validatedPlatformUrl("http://radius.example.com"));
  assert.throws(() => validatedPlatformUrl("http://localhost.example.com"));
});

test("keeps a path prefix so a platform can be hosted below the root", () => {
  assert.equal(
    platformUrl("https://example.com/radius", "api/platform/v1/info"),
    "https://example.com/radius/api/platform/v1/info",
  );
});

test("builds the sync endpoint from the platform base URL", () => {
  assert.equal(
    platformSyncEndpoint("https://northwind.curvehq.sh"),
    "https://northwind.curvehq.sh/api/platform/v1/sync/",
  );
});

test("recovers the base URL from an address that already names sync", () => {
  // `RADIUS_SYNC_ENDPOINT` may be set either way, and both must resolve to
  // the same connection.
  assert.equal(
    platformBaseFromEndpoint(
      "https://northwind.curvehq.sh/api/platform/v1/sync/",
    ),
    "https://northwind.curvehq.sh/",
  );
  assert.equal(
    platformBaseFromEndpoint("https://northwind.curvehq.sh"),
    "https://northwind.curvehq.sh/",
  );
});
