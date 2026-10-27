import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import * as schema from "./schema/index.js";
import type { PlatformPool } from "./client.js";

const MIGRATION_LOCK_NAME = "radius-platform-drizzle-migrations-v1";

export function assertMigrationHistory(
  applied: readonly { hash: string; created_at: string | number }[],
  expected: readonly { hash: string; folderMillis: number }[],
): void {
  for (let index = 0; index < applied.length; index += 1) {
    const actual = applied[index]!;
    const wanted = expected[index];
    if (
      !wanted ||
      actual.hash !== wanted.hash ||
      Number(actual.created_at) !== wanted.folderMillis
    ) {
      throw new Error(
        "PLATFORM_MIGRATION_HISTORY_DIVERGED: migration ledger is not a prefix of this release; review the database history before upgrading",
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
  const expected = readMigrationFiles({ migrationsFolder: folder });
  const client = await pool.$client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      MIGRATION_LOCK_NAME,
    ]);
    try {
      const ledger = await client.query<{ ledger: string | null }>(
        "SELECT to_regclass('radius_migrations.__drizzle_migrations')::text AS ledger",
      );
      if (ledger.rows[0]?.ledger) {
        const applied = await client.query<{
          hash: string;
          created_at: string;
        }>(
          "SELECT hash, created_at FROM radius_migrations.__drizzle_migrations ORDER BY id",
        );
        assertMigrationHistory(applied.rows, expected);
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
