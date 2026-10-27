import type { PlatformPool, PlatformPoolClient } from "./client.js";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "./schema/index.js";

const RUNTIME_ROLE = "radius_runtime";
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

export function runtimeRoleCredentials(
  runtimeUrl: string,
  migrationUrl: string,
) {
  const runtime = new URL(runtimeUrl);
  const migration = new URL(migrationUrl);
  for (const url of [runtime, migration]) {
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      [
        "host",
        "port",
        "database",
        "dbname",
        "user",
        "password",
        "options",
      ].some((key) => url.searchParams.has(key))
    ) {
      throw new Error(
        "Platform role URLs must use PostgreSQL URLs without query overrides for host, database, credentials or role",
      );
    }
  }
  if (
    runtime.hostname !== migration.hostname ||
    (runtime.port || "5432") !== (migration.port || "5432") ||
    runtime.pathname !== migration.pathname
  ) {
    throw new Error(
      "Platform runtime and migration URLs must target the same database",
    );
  }
  if (
    decodeURIComponent(runtime.username) !== RUNTIME_ROLE ||
    !runtime.password
  ) {
    throw new Error(
      "Separate migration credentials require DATABASE_URL to use radius_runtime with a password",
    );
  }
  if (decodeURIComponent(migration.username) === RUNTIME_ROLE) {
    throw new Error(
      "The migration administrator must differ from radius_runtime",
    );
  }
  return { role: RUNTIME_ROLE, password: decodeURIComponent(runtime.password) };
}

/** Called only with the migration administrator, after migrations finish. */
export async function provisionPlatformRuntimeRole(
  pool: PlatformPool,
  credentials: { role: string; password: string },
): Promise<void> {
  if (credentials.role !== RUNTIME_ROLE || !credentials.password)
    throw new Error("Invalid platform runtime credentials");
  const client = await pool.$client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('radius-runtime-role-v1', 0))",
    );
    const existing = await client.query<{ unsafe: boolean }>(
      `SELECT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = pg_roles.oid)) AS unsafe FROM pg_roles WHERE rolname = $1`,
      [RUNTIME_ROLE],
    );
    if (existing.rows[0]?.unsafe)
      throw new Error(
        "Existing radius_runtime role has privileged attributes or memberships; review it before provisioning",
      );
    // PostgreSQL role DDL does not accept bind parameters. Ask PostgreSQL to
    // quote both values, using the raw client so ORM errors cannot print them.
    const command = await client.query<{ ddl: string }>(
      `SELECT format($1::text, $2::text, $3::text) AS ddl`,
      [
        `${existing.rows.length ? "ALTER" : "CREATE"} ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L`,
        RUNTIME_ROLE,
        credentials.password,
      ],
    );
    await client.query(command.rows[0]!.ddl);
    const database = await client.query<{ name: string }>(
      "SELECT current_database() AS name",
    );
    await client.query(
      `GRANT CONNECT ON DATABASE ${identifier(database.rows[0]!.name)} TO radius_runtime`,
    );
    await client.query(
      "GRANT USAGE ON SCHEMA radius_platform, radius_sync TO radius_runtime",
    );
    await client.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA radius_platform, radius_sync TO radius_runtime",
    );
    await client.query(
      "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA radius_platform, radius_sync TO radius_runtime",
    );
    await client.query(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA radius_platform, radius_sync GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO radius_runtime",
    );
    await client.query(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA radius_platform, radius_sync GRANT USAGE, SELECT ON SEQUENCES TO radius_runtime",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function assertSyncDatabaseIsolation(
  pool: PlatformPoolClient,
): Promise<void> {
  const role = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
  );
  if (!role.rows[0] || role.rows[0].rolsuper || role.rows[0].rolbypassrls) {
    throw new Error(
      "SYNC_DATABASE_ROLE_BYPASSES_RLS: use a NOSUPERUSER NOBYPASSRLS runtime role",
    );
  }
  const expected = Object.values(schema)
    .filter((value) => is(value, PgTable))
    .map(getTableConfig)
    .filter((table) => table.schema === "radius_sync")
    .map((table) => table.name);
  const tables = await pool.query<{ relname: string; protected: boolean }>(
    "SELECT c.relname, (c.relrowsecurity AND c.relforcerowsecurity AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)) AS protected FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'radius_sync' AND c.relkind = 'r'",
  );
  const protectedTables = new Set(
    tables.rows
      .filter((table) => table.protected)
      .map((table) => table.relname),
  );
  if (
    !expected.length ||
    expected.some((table) => !protectedTables.has(table))
  ) {
    throw new Error(
      "SYNC_DATABASE_POLICIES_MISSING: apply the approved sync RLS migrations before enabling sync",
    );
  }
}
