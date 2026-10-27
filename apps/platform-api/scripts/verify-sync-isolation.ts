/** Disposable PostgreSQL integration proof. Never point this at a retained DB. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  assertSyncDatabaseIsolation,
  createPlatformDatabase,
  migratePlatformDatabase,
  provisionPlatformOrganization,
  provisionPlatformRuntimeRole,
  runtimeRoleCredentials,
} from "@curve-ai/platform-database";
import { createPlatformApp, type RadiusPlatformServices } from "../src/app.js";
import { withSyncOwner } from "../src/sync/owner.js";
import { createPostgresPlatformServices } from "../src/postgres-services.js";

const runtimeUrl = process.env.DATABASE_URL?.trim();
const migrationUrl = process.env.RADIUS_DATABASE_MIGRATION_URL?.trim();
if (
  !runtimeUrl ||
  !migrationUrl ||
  process.env.RADIUS_DISPOSABLE_DATABASE !== "true"
) {
  throw new Error(
    "Set DATABASE_URL, RADIUS_DATABASE_MIGRATION_URL and RADIUS_DISPOSABLE_DATABASE=true for an isolated test database",
  );
}
const administrator = createPlatformDatabase({
  connectionString: migrationUrl,
  maxConnections: 1,
});
const runtime = createPlatformDatabase({
  connectionString: runtimeUrl,
  maxConnections: 1,
});
type Row = Record<string, unknown>;
function insert(table: string, row: Row) {
  const entries = Object.entries(row);
  return sql`INSERT INTO radius_sync.${sql.identifier(table)} (${sql.join(
    entries.map(([name]) => sql.identifier(name)),
    sql`, `,
  )}) VALUES (${sql.join(
    entries.map(([, value]) => sql`${value}`),
    sql`, `,
  )})`;
}
function sqlstate(error: unknown): unknown {
  for (
    let current = error, depth = 0;
    current && typeof current === "object" && depth < 8;
    depth += 1
  ) {
    if ("code" in current) return current.code;
    current = (current as { cause?: unknown }).cause;
  }
}
async function fixture() {
  const accountId = randomUUID();
  const provisioned = await provisionPlatformOrganization(runtime.pool, {
    apiVersion: 1,
    organization: {
      id: randomUUID(),
      slug: `rls-${randomUUID()}`,
      displayName: "Isolation fixture",
    },
    owner: {
      accountId,
      displayName: "Fixture",
      identity: {
        issuer: "https://fixture.example",
        subject: accountId,
        email: `${accountId}@example.test`,
        emailVerified: true,
      },
    },
  });
  const owner = {
    organizationId: provisioned.organizationId,
    membershipId: provisioned.membershipId,
  };
  const d = randomUUID(),
    p = randomUUID(),
    s = randomUUID(),
    e = randomUUID(),
    a = randomUUID(),
    r = randomUUID(),
    plan = randomUUID(),
    step = randomUUID(),
    f = randomUUID(),
    v = randomUUID();
  const scope = {
    organization_id: owner.organizationId,
    membership_id: owner.membershipId,
  };
  const now = new Date();
  const key = generateKeyPairSync("ed25519").publicKey.export({
    format: "jwk",
  });
  // These rows isolate policy semantics from protocol event validation. The
  // existing verify:sync script separately exercises real service projections.
  const rows: Record<string, Row> = {
    devices: {
      device_id: d,
      ...scope,
      display_name: "Fixture",
      platform: "test",
      public_key_jwk: key,
      app_version: "0.0.1",
      created_at: now,
      last_seen_at: now,
    },
    projects: {
      project_id: p,
      ...scope,
      origin_device_id: d,
      name: "Fixture",
      revision: 1,
      created_at: now,
      updated_at: now,
    },
    sessions: {
      session_id: s,
      ...scope,
      origin_device_id: d,
      project_id: p,
      title: "Fixture",
      status: "active",
      revision: 1,
      created_at: now,
      updated_at: now,
    },
    session_events: {
      event_id: e,
      ...scope,
      session_id: s,
      session_revision: 1,
      event_type: "message",
      source_client_instance_id: d,
      occurred_at: now,
    },
    artifacts: {
      artifact_id: a,
      ...scope,
      session_id: s,
      name: "Fixture",
      artifact_type: "document",
      storage_kind: "file",
      created_by_event_id: e,
      created_at: now,
    },
    file_artifacts: {
      artifact_id: a,
      ...scope,
      mime_type: "text/plain",
      content_sha256: "a".repeat(64),
      byte_size: 1,
    },
    link_artifacts: {
      artifact_id: a,
      url: "https://example.test",
      provider: "fixture",
      external_id: "fixture",
    },
    event_artifacts: { event_id: e, artifact_id: a, relationship: "output" },
    messages: {
      event_id: e,
      role: "assistant",
      message_kind: "final",
      status: "completed",
    },
    message_parts: {
      part_id: randomUUID(),
      message_event_id: e,
      position: 0,
      part_type: "text",
      text: "Fixture",
    },
    agent_runs: {
      agent_run_id: r,
      event_id: e,
      session_id: s,
      provider_key: "fixture",
      started_at: now,
    },
    agent_run_state_updates: {
      event_id: e,
      agent_run_id: r,
      state: "completed",
      occurred_at: now,
    },
    agent_run_presentations: { event_id: e, agent_run_id: r, mode: "inline" },
    reasoning_summaries: {
      event_id: e,
      summary_kind: "analysis",
      summary_text: "Fixture",
    },
    task_plans: {
      plan_id: plan,
      event_id: e,
      title: "Fixture",
      created_at: now,
    },
    task_steps: {
      task_step_id: step,
      plan_id: plan,
      position: 0,
      title: "Fixture",
    },
    task_step_updates: { event_id: e, task_step_id: step, state: "completed" },
    tool_calls: {
      event_id: e,
      capability: "fixture",
      operation: "fixture",
      input_schema_id: "fixture",
      input_schema_version: 1,
      input: {},
    },
    tool_progress_events: {
      event_id: e,
      tool_call_event_id: e,
      progress_schema_id: "fixture",
      progress_schema_version: 1,
      progress: {},
    },
    tool_results: { event_id: e, tool_call_event_id: e, outcome: "success" },
    approval_requests: {
      event_id: e,
      tool_call_event_id: e,
      reason: "Fixture",
    },
    approval_decisions: {
      event_id: e,
      approval_request_event_id: e,
      decision: "approved",
      actor_type: "user",
    },
    errors: {
      event_id: e,
      code: "FIXTURE",
      message: "Fixture",
      retryable: false,
    },
    project_files: {
      project_file_id: f,
      ...scope,
      project_id: p,
      created_at: now,
    },
    project_file_versions: {
      version_id: v,
      ...scope,
      project_id: p,
      project_file_id: f,
      relative_path: "fixture.txt",
      mime_type: "text/plain",
      content_sha256: "b".repeat(64),
      byte_size: 1,
      captured_at: now,
    },
    file_changes: {
      event_id: e,
      agent_run_id: r,
      project_id: p,
      project_file_id: f,
      operation: "create",
      after_version_id: v,
    },
    changes: {
      ...scope,
      change_id: randomUUID(),
      origin_device_id: d,
      project_id: p,
      project_revision: 1,
      kind: "project.upsert",
      payload_sha256: "c".repeat(64),
      envelope: {},
    },
  };
  await withSyncOwner(runtime.db, owner, async (tx) => {
    for (const [table, row] of Object.entries(rows))
      await tx.execute(insert(table, row));
  });
  return { owner, rows, accountId, deviceId: d, key };
}

try {
  await migratePlatformDatabase(administrator.pool);
  await provisionPlatformRuntimeRole(
    administrator.pool,
    runtimeRoleCredentials(runtimeUrl, migrationUrl),
  );
  const boot = await createPostgresPlatformServices({
    connectionString: runtimeUrl,
    migrationConnectionString: migrationUrl,
    requireSyncIsolation: true,
  });
  await boot.close();
  await assert.rejects(
    createPostgresPlatformServices({
      connectionString: migrationUrl,
      requireSyncIsolation: true,
    }),
    /SYNC_DATABASE_ROLE_BYPASSES_RLS/,
  );
  // Idempotence and fresh/existing-cluster provisioning use the same path.
  await provisionPlatformRuntimeRole(
    administrator.pool,
    runtimeRoleCredentials(runtimeUrl, migrationUrl),
  );
  await assertSyncDatabaseIsolation(runtime.pool);
  await administrator.pool.query("ALTER ROLE radius_runtime BYPASSRLS");
  try {
    await assert.rejects(
      assertSyncDatabaseIsolation(runtime.pool),
      /SYNC_DATABASE_ROLE_BYPASSES_RLS/,
    );
  } finally {
    await administrator.pool.query("ALTER ROLE radius_runtime NOBYPASSRLS");
  }
  await administrator.pool.query(
    "ALTER TABLE radius_sync.task_steps DISABLE ROW LEVEL SECURITY",
  );
  try {
    await assert.rejects(
      assertSyncDatabaseIsolation(runtime.pool),
      /SYNC_DATABASE_POLICIES_MISSING/,
    );
  } finally {
    await administrator.pool.query(
      "ALTER TABLE radius_sync.task_steps ENABLE ROW LEVEL SECURITY",
    );
  }
  for (const query of [
    "CREATE SCHEMA runtime_must_not_create",
    "ALTER TABLE radius_sync.devices DISABLE ROW LEVEL SECURITY",
    "SELECT * FROM radius_migrations.__drizzle_migrations",
  ]) {
    await assert.rejects(
      runtime.pool.query(query),
      (error) => sqlstate(error) === "42501",
    );
  }
  await assert.rejects(
    assertSyncDatabaseIsolation(administrator.pool),
    /SYNC_DATABASE_ROLE_BYPASSES_RLS/,
  );
  const first = await fixture();
  const second = await fixture();
  const catalog = await administrator.pool.query<{ relname: string }>(
    "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='radius_sync' AND c.relkind='r' ORDER BY c.relname",
  );
  assert.deepEqual(
    Object.keys(first.rows).sort(),
    catalog.rows.map((row) => row.relname),
  );
  assert.equal(catalog.rows.length, 27);
  for (const { relname: table } of catalog.rows) {
    const row = first.rows[table]!;
    const key = Object.keys(row)[0]!;
    const read = sql`SELECT * FROM radius_sync.${sql.identifier(table)}`;
    assert.equal(
      (await administrator.db.execute(read)).rowCount,
      2,
      `${table}: fixtures populated`,
    );
    assert.equal(
      (await runtime.db.execute(read)).rowCount,
      0,
      `${table}: absent owner denies read`,
    );
    for (const tenant of [first, second]) {
      const result = await withSyncOwner(runtime.db, tenant.owner, (tx) =>
        tx.execute(read),
      );
      assert.equal(result.rowCount, 1, `${table}: unfiltered own rows only`);
    }
    await assert.rejects(
      withSyncOwner(runtime.db, second.owner, (tx) =>
        tx.execute(insert(table, row)),
      ),
      (error) => sqlstate(error) === "42501",
      `${table}: foreign write denied`,
    );
    await assert.rejects(
      runtime.db.execute(insert(table, row)),
      (error) => sqlstate(error) === "42501",
      `${table}: absent owner denies write`,
    );
    await withSyncOwner(runtime.db, second.owner, async (tx) => {
      const updated = await tx.execute(
        sql`UPDATE radius_sync.${sql.identifier(table)} SET ${sql.identifier(key)} = ${sql.identifier(key)} WHERE ${sql.identifier(key)} = ${row[key]} RETURNING *`,
      );
      assert.equal(updated.rowCount, 0, `${table}: foreign update invisible`);
      const deleted = await tx.execute(
        sql`DELETE FROM radius_sync.${sql.identifier(table)} WHERE ${sql.identifier(key)} = ${row[key]} RETURNING *`,
      );
      assert.equal(deleted.rowCount, 0, `${table}: foreign delete invisible`);
    });
  }
  const pid = await runtime.pool.query<{ pid: number }>(
    "SELECT pg_backend_pid() AS pid",
  );
  const noContext = async () => {
    const result = await runtime.pool.query<{
      pid: number;
      owner: string | null;
    }>(
      "SELECT pg_backend_pid() AS pid, nullif(current_setting('radius_sync.membership_id', true), '') AS owner",
    );
    assert.equal(result.rows[0]!.pid, pid.rows[0]!.pid);
    assert.equal(result.rows[0]!.owner, null);
    assert.equal(
      (await runtime.db.execute(sql`SELECT * FROM radius_sync.devices`))
        .rowCount,
      0,
    );
  };
  await withSyncOwner(runtime.db, first.owner, async (tx) => {
    assert.equal(
      (await tx.execute(sql`SELECT * FROM radius_sync.devices`)).rowCount,
      1,
    );
  });
  await noContext();
  await assert.rejects(
    withSyncOwner(runtime.db, first.owner, async () => {
      throw new Error("ROLLBACK_PROBE");
    }),
    /ROLLBACK_PROBE/,
  );
  await noContext();
  const concurrent = await Promise.all(
    [first, second].map((tenant) =>
      withSyncOwner(runtime.db, tenant.owner, (tx) =>
        tx.execute<{ device_id: string }>(
          sql`SELECT device_id FROM radius_sync.devices`,
        ),
      ),
    ),
  );
  assert.deepEqual(
    concurrent.map((result) => result.rows[0]!.device_id),
    [first.deviceId, second.deviceId],
  );
  await noContext();
  const reused = await runtime.pool.query<{
    pid: number;
    owner: string | null;
  }>(
    "SELECT pg_backend_pid() AS pid, nullif(current_setting('radius_sync.membership_id', true), '') AS owner",
  );
  assert.equal(reused.rows[0]!.pid, pid.rows[0]!.pid);
  assert.equal(reused.rows[0]!.owner, null);
  assert.equal(
    (await runtime.db.execute(sql`SELECT * FROM radius_sync.devices`)).rowCount,
    0,
  );
  const app = createPlatformApp(
    {
      authenticate: async () => ({
        accountId: second.accountId,
        response: {
          apiVersion: 1,
          accountId: second.accountId,
          organizations: [
            {
              id: second.owner.organizationId,
              slug: "fixture",
              displayName: "Fixture",
              role: "owner",
            },
          ],
        },
      }),
      authenticateBrowserSession: async () => null,
    } as unknown as RadiusPlatformServices,
    { syncDatabase: runtime.db },
  );
  const response = await app.request("/api/platform/v1/sync/devices/register", {
    method: "POST",
    headers: {
      authorization: "Bearer fixture",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      clientInstanceId: first.deviceId,
      publicKeyJwk: first.key,
      displayName: "Foreign",
      platform: "test",
      appVersion: "0.0.1",
    }),
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "DEVICE_IDENTITY_CONFLICT",
  });
  assert.equal(
    (await runtime.db.execute(sql`SELECT * FROM radius_sync.devices`)).rowCount,
    0,
  );
  console.info(
    "Sync isolation passed: 27 populated tables, unfiltered read/write boundaries, effective role, reused connection commit/rollback cleanup, foreign-device HTTP409.",
  );
} finally {
  await runtime.pool.end();
  await administrator.pool.end();
}
