import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parse } from "@pgsql/parser/v17";

test("embedded auth migration is additive and confined to the approved namespace", async () => {
  const source = await readFile(
    new URL("../drizzle/0004_embedded_auth.sql", import.meta.url),
    "utf8",
  );
  const parsed = await parse(source.replaceAll("--> statement-breakpoint", ""));
  assert.ok(parsed.stmts.length > 30);
  assert.equal(
    (source.match(/CREATE TABLE "radius_auth"\./g) ?? []).length,
    12,
  );
  assert.doesNotMatch(
    source,
    /DROP|TRUNCATE|DELETE FROM|UPDATE "|radius_platform|radius_sync/,
  );
  assert.match(source, /UNIQUE\("client_id"\)/);
  assert.doesNotMatch(source, /"issuer" text/);
  assert.match(
    source,
    /UNIQUE INDEX "account_providerId_accountId_uidx"[^;]*\("provider_id","account_id"\)/,
  );
  assert.match(
    source,
    /UNIQUE INDEX "oauthClientResource_clientId_resourceId_uidx"/,
  );
  assert.match(source, /ON DELETE cascade/);
  assert.match(source, /ON DELETE set null/);
  assert.match(source, /"expires_at" timestamp with time zone/);
});
