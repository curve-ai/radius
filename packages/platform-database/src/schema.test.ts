import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parse } from "@pgsql/parser/v17";

const corePath = fileURLToPath(
  new URL("../drizzle/0000_platform_core.sql", import.meta.url),
);
const invariantsPath = fileURLToPath(
  new URL("../drizzle/0001_platform_invariants.sql", import.meta.url),
);

const expectedTables = [
  "accounts",
  "account_identities",
  "platform_sessions",
  "organizations",
  "organization_memberships",
  "developer_tokens",
  "developer_token_scopes",
  "agents",
  "agent_environments",
  "developer_token_agents",
  "agent_deployment_uploads",
  "agent_deployments",
  "agent_deployment_artifacts",
  "agent_environment_revisions",
  "physical_devices",
  "client_installations",
  "client_installation_observations",
  "agent_installations",
  "agent_installation_observations",
  "idempotency_records",
  "job_outbox_messages",
  "audit_events",
] as const;

async function migrations(): Promise<{ core: string; invariants: string }> {
  return {
    core: await readFile(corePath, "utf8"),
    invariants: await readFile(invariantsPath, "utf8"),
  };
}

test("the Drizzle migrations parse as PostgreSQL 17", async () => {
  const { core, invariants } = await migrations();
  const parsed = await parse(
    `${core}\n${invariants}`.replaceAll("--> statement-breakpoint", ""),
  );
  assert.ok(parsed.stmts.length > 60);
});

test("the Drizzle core has one table per approved Platform subject", async () => {
  const { core } = await migrations();
  for (const table of expectedTables) {
    assert.match(
      core,
      new RegExp(`CREATE TABLE "radius_platform"\\."${table}" \\(`),
      `missing ${table}`,
    );
  }
  assert.equal(
    (core.match(/CREATE TABLE "radius_platform"\./g) ?? []).length,
    22,
  );
});

test("custom Drizzle migration preserves append-only and derived-state invariants", async () => {
  const { invariants } = await migrations();
  for (const trigger of [
    "agent_deployment_artifacts_prevent_update",
    "agent_environment_revisions_prevent_update",
    "client_installation_observations_prevent_update",
    "agent_installation_observations_prevent_update",
    "audit_events_prevent_update",
  ]) {
    assert.match(invariants, new RegExp(`CREATE TRIGGER ${trigger}`));
  }
  for (const view of [
    "current_agent_environment_deployments",
    "organization_agent_inventory",
    "agent_deployment_evidence",
    "ready_job_outbox",
  ]) {
    assert.match(
      invariants,
      new RegExp(`CREATE VIEW radius_platform\\.${view}`),
    );
  }
  assert.match(invariants, /UNIQUE NULLS NOT DISTINCT/);
});

test("the Platform requires neither extensions nor database-generated UUIDs", async () => {
  const { core, invariants } = await migrations();
  const sql = `${core}\n${invariants}`;
  assert.doesNotMatch(sql, /CREATE EXTENSION/i);
  assert.doesNotMatch(sql, /gen_random_uuid|uuid_generate|uuidv[47]/i);
  assert.match(core, /"token_hash" "bytea" NOT NULL/g);
  assert.doesNotMatch(
    sql,
    /token_plaintext|access_token text|registry_password|private_key text/i,
  );
});
