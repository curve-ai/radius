/** Creates and drops only databases allocated by this verification run. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  createPlatformDatabase,
  migratePlatformDatabase,
  provisionPlatformOrganization,
} from "@curve-ai/platform-database";

const administratorUrl = process.env.RADIUS_DATABASE_MIGRATION_URL?.trim();
if (!administratorUrl || process.env.RADIUS_DISPOSABLE_DATABASE !== "true")
  throw new Error(
    "Use RADIUS_DATABASE_MIGRATION_URL and RADIUS_DISPOSABLE_DATABASE=true with a disposable PostgreSQL cluster",
  );
const control = createPlatformDatabase({
  connectionString: administratorUrl,
  maxConnections: 1,
});
const directory = await mkdtemp(path.join(tmpdir(), "radius-sync-upgrade-"));
const source = fileURLToPath(
  new URL("../../../packages/platform-database/drizzle/", import.meta.url),
);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const journal = JSON.parse(
  await readFile(path.join(source, "meta/_journal.json"), "utf8"),
) as { entries: { idx: number; tag: string; when: number }[] };
const databases: string[] = [];
const password = randomBytes(24).toString("hex");
async function database(label: string) {
  const name = `radius_sync_${label}_${randomBytes(8).toString("hex")}`;
  await control.pool.query(`CREATE DATABASE "${name}"`);
  databases.push(name);
  const admin = new URL(administratorUrl!);
  admin.pathname = `/${name}`;
  const runtime = new URL(admin);
  runtime.username = "radius_runtime";
  runtime.password = password;
  return { admin: admin.toString(), runtime: runtime.toString() };
}
function run(script: string, urls: Awaited<ReturnType<typeof database>>) {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "apps/platform-api/scripts", script)],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: urls.runtime,
        RADIUS_DATABASE_MIGRATION_URL: urls.admin,
        RADIUS_SYNC_CURSOR_SECRET: randomBytes(32).toString("hex"),
        RADIUS_DISPOSABLE_DATABASE: "true",
      },
    },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, script);
}
async function history(label: string, legacy = false) {
  const folder = path.join(directory, label);
  await mkdir(path.join(folder, "meta"), { recursive: true });
  const entries = journal.entries.filter(
    (entry) => entry.idx <= (legacy ? 2 : 3),
  );
  if (legacy)
    entries.push({
      ...journal.entries[4]!,
      idx: 3,
      tag: "0003_sync_row_security",
      when: 1788528797960,
    });
  await writeFile(
    path.join(folder, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries }),
  );
  for (const entry of entries)
    await writeFile(
      path.join(folder, `${entry.tag}.sql`),
      await readFile(
        path.join(
          source,
          `${entry.tag === "0003_sync_row_security" ? "0004_sync_row_security" : entry.tag}.sql`,
        ),
      ),
    );
  return folder;
}

try {
  run("verify-sync-isolation.ts", await database("fresh"));
  run("verify-sync.ts", await database("functional"));
  const upgrade = await database("upgrade");
  const previous = createPlatformDatabase({ connectionString: upgrade.admin });
  let saved: Awaited<ReturnType<typeof provisionPlatformOrganization>>;
  let ledger: unknown;
  try {
    await migratePlatformDatabase(previous.pool, await history("main"));
    ledger = (
      await previous.pool.query(
        "SELECT hash, created_at FROM radius_migrations.__drizzle_migrations ORDER BY id",
      )
    ).rows;
    saved = await provisionPlatformOrganization(previous.pool, {
      apiVersion: 1,
      organization: {
        id: "11111111-2222-4333-8444-555555555555",
        slug: "retained-upgrade",
        displayName: "Retained",
      },
      owner: {
        accountId: "66666666-7777-4888-8999-000000000000",
        displayName: "Retained",
        identity: {
          issuer: "https://fixture.example",
          subject: "retained",
          email: "retained@example.test",
          emailVerified: true,
        },
      },
    });
    assert.equal(
      (
        await previous.pool.query(
          "SELECT relname FROM pg_class WHERE relnamespace='radius_sync'::regnamespace AND relrowsecurity",
        )
      ).rows.length,
      0,
    );
  } finally {
    await previous.pool.end();
  }
  run("verify-sync-isolation.ts", upgrade);
  const upgraded = createPlatformDatabase({ connectionString: upgrade.admin });
  try {
    const applied = (
      await upgraded.pool.query(
        "SELECT hash, created_at FROM radius_migrations.__drizzle_migrations ORDER BY id",
      )
    ).rows;
    assert.equal(applied.length, 5);
    assert.deepEqual(applied.slice(0, 4), ledger);
    assert.equal(
      (
        await upgraded.pool.query(
          "SELECT membership_id FROM radius_platform.organization_memberships WHERE membership_id=$1",
          [saved!.membershipId],
        )
      ).rows.length,
      1,
    );
    await upgraded.pool.query(
      "SELECT provider_session_id FROM radius_sync.agent_runs LIMIT 0",
    );
  } finally {
    await upgraded.pool.end();
  }
  const divergent = await database("divergent");
  const legacy = createPlatformDatabase({ connectionString: divergent.admin });
  try {
    await migratePlatformDatabase(legacy.pool, await history("legacy", true));
    const before = (
      await legacy.pool.query(
        "SELECT * FROM radius_migrations.__drizzle_migrations ORDER BY id",
      )
    ).rows;
    await assert.rejects(
      migratePlatformDatabase(legacy.pool),
      /PLATFORM_MIGRATION_HISTORY_DIVERGED/,
    );
    assert.deepEqual(
      (
        await legacy.pool.query(
          "SELECT * FROM radius_migrations.__drizzle_migrations ORDER BY id",
        )
      ).rows,
      before,
    );
    assert.equal(
      (
        await legacy.pool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='radius_sync' AND table_name='agent_runs' AND column_name='provider_session_id'",
        )
      ).rows.length,
      0,
    );
  } finally {
    await legacy.pool.end();
  }
  console.info(
    "Sync database verification passed: fresh initialization, protected service projections, main upgrade preserves ledger/data, divergent history rejected before writes.",
  );
} finally {
  for (const name of databases.reverse())
    await control.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await control.pool.end();
  await rm(directory, { recursive: true, force: true });
}
