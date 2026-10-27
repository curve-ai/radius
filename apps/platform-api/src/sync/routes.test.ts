import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";

import {
  platformSchema,
  type PlatformDatabase,
} from "@curve-ai/platform-database";

import { createPlatformApp, type RadiusPlatformServices } from "../app.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const organizationId = "12121212-1212-4212-8212-121212121212";

/**
 * The early guard assertions below are about routing and scoping, which are decided before
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
  organizations: {
    id: string;
    slug: string;
    displayName: string;
    role: "owner";
  }[] = [],
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

for (const code of ["23505", "42501", "08006"]) {
  test(`device registration rolls back wrapped ${code} before responding`, async () => {
    const queries: string[] = [];
    const client = {
      async query(config: { text: string }) {
        queries.push(config.text);
        if (config.text.includes('insert into "radius_sync"."devices"')) {
          throw Object.assign(new Error("injected driver error"), { code });
        }
        return {
          rows: config.text.includes('"organization_memberships"')
            ? [["33333333-3333-4333-8333-333333333333"]]
            : [],
        };
      },
    };
    const database = drizzle(client as never, { schema: platformSchema });
    const app = createPlatformApp(
      services([
        {
          id: organizationId,
          slug: "acme",
          displayName: "Acme",
          role: "owner",
        },
      ]),
      { syncDatabase: database },
    );
    const { publicKey } = generateKeyPairSync("ed25519");
    const response = await app.request(
      "/api/platform/v1/sync/devices/register",
      {
        method: "POST",
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          clientInstanceId: "44444444-4444-4444-8444-444444444444",
          displayName: "Test device",
          platform: "darwin",
          appVersion: "0.0.1",
          publicKeyJwk: publicKey.export({ format: "jwk" }),
        }),
      },
    );
    assert.equal(response.status, code === "08006" ? 500 : 409);
    if (code !== "08006")
      assert.deepEqual(await response.json(), {
        error: "DEVICE_IDENTITY_CONFLICT",
      });
    assert.equal(queries.at(-1), "rollback");
    assert.ok(!queries.includes("commit"));
  });
}
