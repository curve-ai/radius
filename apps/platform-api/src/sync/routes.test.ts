import assert from "node:assert/strict";
import test from "node:test";

import type { PlatformDatabase } from "@curve-ai/platform-database";

import { createPlatformApp, type RadiusPlatformServices } from "../app.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const organizationId = "12121212-1212-4212-8212-121212121212";

/**
 * Every assertion below is about routing and scoping, which are decided before
 * a query is ever built. A database that throws proves that: if one of these
 * paths reached storage, the test would fail loudly rather than quietly pass.
 */
function unusedDatabase(): PlatformDatabase {
  return new Proxy(
    {},
    {
      get() {
        throw new Error("DATABASE_SHOULD_NOT_BE_TOUCHED");
      },
    },
  ) as PlatformDatabase;
}

function services(
  organizations: { id: string; slug: string; displayName: string; role: "owner" }[] = [],
): RadiusPlatformServices {
  return {
    authenticate: async (token: string) =>
      token === "valid"
        ? { accountId, response: { apiVersion: 1, accountId, organizations } }
        : null,
    authenticateBrowserSession: async () => null,
  } as unknown as RadiusPlatformServices;
}

test("sync routes are absent unless a database is supplied", async () => {
  const response = await createPlatformApp(services()).request(
    "/api/platform/v1/sync/capabilities",
    { headers: { authorization: "Bearer valid" } },
  );
  assert.equal(response.status, 404);
});

test("sync sits behind the platform identity middleware", async () => {
  const app = createPlatformApp(services(), {
    syncDatabase: unusedDatabase(),
  });
  const response = await app.request("/api/platform/v1/sync/capabilities");
  assert.equal(response.status, 401);
});

test("capabilities advertises the protocol an authenticated caller may use", async () => {
  const app = createPlatformApp(services(), {
    syncDatabase: unusedDatabase(),
  });
  const response = await app.request("/api/platform/v1/sync/capabilities", {
    headers: { authorization: "Bearer valid" },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    protocolVersions: number[];
    maxBatchSize: number;
  };
  assert.deepEqual(body.protocolVersions, [1]);
  assert.equal(body.maxBatchSize, 100);
});

test("a caller with no organization cannot reach anyone's conversations", async () => {
  const app = createPlatformApp(services([]), {
    syncDatabase: unusedDatabase(),
  });
  const response = await app.request("/api/platform/v1/sync/pull", {
    headers: { authorization: "Bearer valid" },
  });
  assert.equal(response.status, 403);
  assert.equal(
    ((await response.json()) as { error: string }).error,
    "SYNC_ORGANIZATION_AMBIGUOUS",
  );
});

test("a caller in more than one organization must be narrowed to one first", async () => {
  const app = createPlatformApp(
    services([
      { id: organizationId, slug: "acme", displayName: "Acme", role: "owner" },
      {
        id: "13131313-1313-4313-8313-131313131313",
        slug: "other",
        displayName: "Other",
        role: "owner",
      },
    ]),
    { syncDatabase: unusedDatabase() },
  );
  const response = await app.request("/api/platform/v1/sync/pull", {
    headers: { authorization: "Bearer valid" },
  });
  assert.equal(response.status, 403);
  assert.equal(
    ((await response.json()) as { error: string }).error,
    "SYNC_ORGANIZATION_AMBIGUOUS",
  );
});

test("the overview and dashboard revocation are scoped before any query runs", async () => {
  const app = createPlatformApp(services([]), {
    syncDatabase: unusedDatabase(),
  });
  for (const [path, method] of [
    ["/api/platform/v1/sync/overview", "GET"],
    [
      "/api/platform/v1/sync/devices/22222222-2222-4222-8222-222222222222/revoke",
      "POST",
    ],
  ] as const) {
    const response = await app.request(path, {
      method,
      headers: { authorization: "Bearer valid" },
    });
    assert.equal(response.status, 403, path);
    assert.equal(
      ((await response.json()) as { error: string }).error,
      "SYNC_ORGANIZATION_AMBIGUOUS",
    );
  }
  const anonymous = await app.request("/api/platform/v1/sync/overview");
  assert.equal(anonymous.status, 401);
});
