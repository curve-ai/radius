import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import * as schema from "./schema/index.js";

export interface RadiusDatabase {
  client: Client;
  db: LibSQLDatabase<typeof schema>;
  close(): void;
}

export interface OpenRadiusDatabaseOptions {
  path: string;
  encryptionKey?: string;
}

export async function openRadiusDatabase(
  options: OpenRadiusDatabaseOptions,
): Promise<RadiusDatabase> {
  const client = createClient({
    url: options.path === ":memory:" ? ":memory:" : `file:${options.path}`,
    ...(options.encryptionKey ? { encryptionKey: options.encryptionKey } : {}),
  });
  await client.execute("PRAGMA foreign_keys = ON");
  const db = drizzle(client, { schema });

  return {
    client,
    db,
    close: () => client.close(),
  };
}

export async function migrateRadiusDatabase(
  database: RadiusDatabase,
  migrationsFolder: string,
): Promise<void> {
  await migrate(database.db, {
    migrationsFolder,
    migrationsTable: "radius_schema_migrations",
  });
}
