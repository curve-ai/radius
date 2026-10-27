import assert from "node:assert/strict";
import test from "node:test";
import { assertMigrationHistory } from "./migrations.js";

const expected = [
  { hash: "core", folderMillis: 100 },
  { hash: "main", folderMillis: 200 },
  { hash: "rls", folderMillis: 300 },
];
test("migration history accepts fresh, prefix and fully applied histories", () => {
  for (let length = 0; length <= expected.length; length += 1) {
    assert.doesNotThrow(() =>
      assertMigrationHistory(
        expected.slice(0, length).map((entry) => ({
          hash: entry.hash,
          created_at: String(entry.folderMillis),
        })),
        expected,
      ),
    );
  }
});
test("migration history rejects skipped, modified, reordered and unknown entries", () => {
  const entries = expected.map((entry) => ({
    hash: entry.hash,
    created_at: entry.folderMillis,
  }));
  for (const applied of [
    [entries[0]!, entries[2]!],
    [{ ...entries[0]!, hash: "modified" }],
    [{ ...entries[0]!, created_at: 101 }],
    [entries[1]!, entries[0]!],
    [...entries, { hash: "future", created_at: 400 }],
  ]) {
    assert.throws(
      () => assertMigrationHistory(applied, expected),
      /PLATFORM_MIGRATION_HISTORY_DIVERGED/,
    );
  }
});
