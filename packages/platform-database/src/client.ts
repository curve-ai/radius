import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema/index.js";

export type PlatformDatabase = NodePgDatabase<typeof schema>;

export interface PlatformDatabaseClient {
  database: PlatformDatabase;
  pool: Pool;
  close(): Promise<void>;
}

export function createPlatformDatabase(
  config: string | PoolConfig,
): PlatformDatabaseClient {
  const pool = new Pool(
    typeof config === "string" ? { connectionString: config } : config,
  );
  const database = drizzle(pool, { schema });
  return {
    database,
    pool,
    close: () => pool.end(),
  };
}

export async function migratePlatformDatabase(
  database: PlatformDatabase,
  migrationsFolder: string,
): Promise<void> {
  await migrate(database, { migrationsFolder });
}
