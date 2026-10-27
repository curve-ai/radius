import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { PlatformPool } from "@curve-ai/platform-database";
import {
  normalizeOidcProvisioningPolicy,
  provisionOidcBrowserSession,
} from "./browser-session.js";
import { DEVELOPMENT_ACCOUNT_ID } from "./development-auth.js";

test("a second hosted identity cannot claim the default local owner", async () => {
  const queries: string[] = [];
  const query = async (statement: Parameters<PgDialect["sqlToQuery"]>[0]) => {
    const sql = new PgDialect().sqlToQuery(statement).sql;
    queries.push(sql);
    const rows = sql.includes("SELECT organization_id FROM")
      ? [{ organization_id: "org" }]
      : sql.includes("SELECT 1 FROM radius_platform.account_identities")
        ? [{ existing: true }]
        : [];
    return { rows, rowCount: rows.length };
  };
  const pool = {
    db: {
      transaction: async (work: (tx: unknown) => Promise<unknown>) =>
        work({ execute: query }),
    },
  } as unknown as PlatformPool;
  const policy = normalizeOidcProvisioningPolicy({
    organizationSlug: "dev",
    role: "owner",
    bootstrapAccountId: DEVELOPMENT_ACCOUNT_ID,
    allowedEmails: ["second@example.com"],
  });
  await assert.rejects(
    provisionOidcBrowserSession(
      pool,
      {
        issuer: "https://app.curvehq.sh/api/auth",
        subject: "second",
        email: "second@example.com",
        emailVerified: true,
        displayName: "Second",
      },
      policy,
      { organizationBound: true, localDevelopmentOwner: true },
    ),
    /another identity/,
  );
  assert.match(queries[0]!, /advisory/);
  assert.equal(
    queries.some((sql) => /^\s*(INSERT|UPDATE)/.test(sql)),
    false,
  );
});
