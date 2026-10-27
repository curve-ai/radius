import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import * as schema from "./schema/index.js";
import type { PlatformPool } from "./client.js";

const MIGRATION_LOCK_NAME = "radius-platform-drizzle-migrations-v1";

export function assertPlatformMigrationHistory(
  applied: ReadonlyArray<{ hash: string; created_at: string | number }>,
  migrations: ReadonlyArray<Pick<MigrationMeta, "hash" | "folderMillis">>,
): void {
  for (const [index, row] of applied.entries()) {
    const expected = migrations[index];
    if (
      !expected ||
      row.hash !== expected.hash ||
      String(row.created_at) !== String(expected.folderMillis)
    ) {
      throw new Error(
        "PLATFORM_MIGRATION_HISTORY_DIVERGED: This database does not match the published migration history. Audit its branch history before upgrading; no migrations were applied.",
      );
    }
  }
}

export async function migratePlatformDatabase(
  pool: PlatformPool,
  migrationsFolder?: string,
): Promise<void> {
  const folder =
    migrationsFolder ?? fileURLToPath(new URL("../drizzle", import.meta.url));
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  const client = await pool.$client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      MIGRATION_LOCK_NAME,
    ]);
    try {
      const ledger = await client.query<{ relation: string | null }>(
        "SELECT to_regclass('radius_migrations.__drizzle_migrations')::text AS relation",
      );
      if (ledger.rows[0]?.relation) {
        const applied = await client.query<{
          hash: string;
          created_at: string;
        }>(
          'SELECT hash, created_at FROM "radius_migrations"."__drizzle_migrations" ORDER BY id',
        );
        assertPlatformMigrationHistory(applied.rows, migrations);
      }
      await migrate(drizzle(client, { schema }), {
        migrationsFolder: folder,
        migrationsSchema: "radius_migrations",
        migrationsTable: "__drizzle_migrations",
      });
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
        MIGRATION_LOCK_NAME,
      ]);
    }
  } finally {
    client.release();
  }
}
