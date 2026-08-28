import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "./schema/index.js";
import type { PlatformPool } from "./client.js";

const MIGRATION_LOCK_NAME = "radius-platform-drizzle-migrations-v1";

export async function migratePlatformDatabase(
  pool: PlatformPool,
  migrationsFolder?: string,
): Promise<void> {
  const client = await pool.$client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      MIGRATION_LOCK_NAME,
    ]);
    try {
      await migrate(drizzle(client, { schema }), {
        migrationsFolder:
          migrationsFolder ??
          fileURLToPath(new URL("../drizzle", import.meta.url)),
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
