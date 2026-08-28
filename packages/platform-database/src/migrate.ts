import { createPlatformPool } from "./client.js";
import { migratePlatformDatabase } from "./migrations.js";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = createPlatformPool({
  connectionString,
  applicationName: "radius-platform-migrate",
  maxConnections: 1,
  statementTimeoutMs: 60_000,
});

try {
  await migratePlatformDatabase(
    pool,
    process.env.RADIUS_PLATFORM_MIGRATIONS_DIR,
  );
  console.info(JSON.stringify({ ok: true }));
} finally {
  await pool.end();
}
