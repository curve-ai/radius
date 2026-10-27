import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";

import { assertPlatformMigrationHistory } from "./migrations.js";

const migrations = readMigrationFiles({
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
});
const ledger = migrations.map(({ hash, folderMillis }) => ({
  hash,
  created_at: String(folderMillis),
}));

test("accepts fresh, main-only, and fully upgraded migration histories", () => {
  assert.equal(migrations.length, 5);
  for (const count of [0, 4, 5]) {
    assert.doesNotThrow(() =>
      assertPlatformMigrationHistory(ledger.slice(0, count), migrations),
    );
  }
});

test("rejects an old auth-branch ledger that skipped main's published migration", () => {
  const oldAuthHistory = [...ledger.slice(0, 3), ledger[4]!];
  assert.throws(
    () => assertPlatformMigrationHistory(oldAuthHistory, migrations),
    /PLATFORM_MIGRATION_HISTORY_DIVERGED/,
  );
});

test("rejects changed migration contents, timestamps, and unknown later migrations", () => {
  for (const history of [
    [{ ...ledger[0]!, hash: "changed" }],
    [{ ...ledger[0]!, created_at: "0" }],
    [...ledger, { hash: "unknown", created_at: "9999999999999" }],
  ]) {
    assert.throws(
      () => assertPlatformMigrationHistory(history, migrations),
      /PLATFORM_MIGRATION_HISTORY_DIVERGED/,
    );
  }
});
