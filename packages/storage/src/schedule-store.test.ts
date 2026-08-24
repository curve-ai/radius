import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";

import { migrateRadiusDatabase, openRadiusDatabase } from "./database.js";
import {
  claimScheduledRun,
  createSchedule,
  getNextScheduledRunWakeAt,
  listScheduledRuns,
  markScheduledRunDispatched,
  materializeScheduledRun,
  releaseScheduledRun,
  retryScheduledRun,
  updateSchedule,
} from "./schedule-store.js";
import { clientInstances, scheduledRuns } from "./schema.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const clientId = "19353755-3c5e-4529-b58d-c74dacf7b68d";

async function removeTemporaryDirectory(directory: string): Promise<void> {
  try {
    await rm(directory, { force: true, recursive: true });
  } catch (error) {
    if (
      process.platform === "win32" &&
      (error as NodeJS.ErrnoException).code === "EBUSY"
    ) {
      return;
    }
    throw error;
  }
}

async function withDatabase(
  callback: (
    database: Awaited<ReturnType<typeof openRadiusDatabase>>,
  ) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "radius-scheduler-store-"),
  );
  const database = await openRadiusDatabase({
    path: path.join(directory, "radius.db"),
  });
  try {
    await migrateRadiusDatabase(database, migrationsFolder);
    const now = Date.parse("2026-08-22T12:00:00.000Z");
    await database.db.insert(clientInstances).values({
      id: clientId,
      displayName: "Test Mac",
      platform: "darwin",
      publicKeyJwk: JSON.stringify({ kty: "OKP", crv: "Ed25519", x: "test" }),
      isLocal: true,
      createdAtMs: now,
      updatedAtMs: now,
    });
    await callback(database);
  } finally {
    database.close();
    await removeTemporaryDirectory(directory);
  }
}

test("materializes each occurrence once and snapshots the request", async () => {
  await withDatabase(async (database) => {
    const now = Date.parse("2026-08-22T12:00:00.000Z");
    const schedule = await createSchedule(database, {
      originClientInstanceId: clientId,
      title: "Daily briefing",
      cronExpression: "0 9 * * 1-5",
      timezone: "America/New_York",
      requestSchemaId: "radius.agent-task",
      requestSchemaVersion: 1,
      request: { prompt: "Prepare the briefing" },
      now,
    });
    const scheduledForMs = Date.parse("2026-08-24T13:00:00.000Z");
    const first = await materializeScheduledRun(database, {
      schedule,
      scheduledForMs,
      now,
    });
    const duplicate = await materializeScheduledRun(database, {
      schedule,
      scheduledForMs,
      now: now + 1,
    });

    assert.equal(first.inserted, true);
    assert.equal(duplicate.inserted, false);
    assert.equal(duplicate.run.id, first.run.id);
    assert.equal(first.run.requestJson, '{"prompt":"Prepare the briefing"}');
    assert.equal((await listScheduledRuns(database, schedule.id)).length, 1);
  });
});

test("reclaims expired leases and rejects a stale lease token", async () => {
  await withDatabase(async (database) => {
    const now = Date.parse("2026-08-22T12:00:00.000Z");
    const schedule = await createSchedule(database, {
      originClientInstanceId: clientId,
      title: "Crash recovery",
      cronExpression: "* * * * *",
      timezone: "UTC",
      requestSchemaId: "radius.agent-task",
      requestSchemaVersion: 1,
      request: { prompt: "Recover me" },
      now,
    });
    await materializeScheduledRun(database, {
      schedule,
      scheduledForMs: now,
      now,
    });

    const firstLease = await claimScheduledRun(database, {
      now,
      leaseDurationMs: 1_000,
    });
    assert.ok(firstLease);
    assert.equal(firstLease.attemptCount, 1);
    assert.equal(
      await claimScheduledRun(database, {
        now: now + 999,
        leaseDurationMs: 1_000,
      }),
      null,
    );

    const secondLease = await claimScheduledRun(database, {
      now: now + 1_000,
      leaseDurationMs: 1_000,
    });
    assert.ok(secondLease);
    assert.equal(secondLease.id, firstLease.id);
    assert.equal(secondLease.attemptCount, 2);
    assert.notEqual(secondLease.leaseToken, firstLease.leaseToken);
    assert.equal(
      await markScheduledRunDispatched(
        database,
        firstLease.id,
        firstLease.leaseToken,
        null,
      ),
      false,
    );
    assert.equal(
      await markScheduledRunDispatched(
        database,
        secondLease.id,
        secondLease.leaseToken,
        null,
      ),
      true,
    );
  });
});

test("persists retry readiness and keeps ask runs unavailable", async () => {
  await withDatabase(async (database) => {
    const now = Date.parse("2026-08-22T12:00:00.000Z");
    const schedule = await createSchedule(database, {
      originClientInstanceId: clientId,
      title: "Approval required",
      cronExpression: "0 9 * * *",
      timezone: "UTC",
      missedRunPolicy: "ask",
      requestSchemaId: "radius.agent-task",
      requestSchemaVersion: 1,
      request: { prompt: "Ask first" },
      now,
    });
    const materialized = await materializeScheduledRun(database, {
      schedule,
      scheduledForMs: now,
      availableAtMs: null,
      now,
    });
    assert.equal(await getNextScheduledRunWakeAt(database), null);
    assert.equal(
      await claimScheduledRun(database, { now, leaseDurationMs: 1_000 }),
      null,
    );

    assert.equal(
      await releaseScheduledRun(database, materialized.run.id, now),
      true,
    );
    const claimed = await claimScheduledRun(database, {
      now,
      leaseDurationMs: 1_000,
    });
    assert.ok(claimed);
    assert.equal(
      await retryScheduledRun(database, claimed.id, claimed.leaseToken, {
        availableAtMs: now + 5_000,
        errorCode: "NETWORK_UNAVAILABLE",
      }),
      true,
    );
    assert.equal(await getNextScheduledRunWakeAt(database), now + 5_000);
  });
});

test("schedule edits advance the revision without mutating existing runs", async () => {
  await withDatabase(async (database) => {
    const now = Date.parse("2026-08-22T12:00:00.000Z");
    const schedule = await createSchedule(database, {
      originClientInstanceId: clientId,
      title: "Original",
      cronExpression: "0 9 * * *",
      timezone: "UTC",
      requestSchemaId: "radius.agent-task",
      requestSchemaVersion: 1,
      request: { prompt: "Original request" },
      now,
    });
    const run = await materializeScheduledRun(database, {
      schedule,
      scheduledForMs: now,
      now,
    });
    const updated = await updateSchedule(database, schedule.id, {
      title: "Updated",
      request: { prompt: "Updated request" },
      now: now + 1,
    });

    assert.equal(updated.revision, 2);
    const [storedRun] = await database.db
      .select()
      .from(scheduledRuns)
      .where(eq(scheduledRuns.id, run.run.id));
    assert.equal(storedRun?.scheduleRevision, 1);
    assert.equal(storedRun?.requestJson, '{"prompt":"Original request"}');
  });
});

test("paginates scheduled-run history", async () => {
  await withDatabase(async (database) => {
    const now = Date.parse("2026-08-22T12:00:00.000Z");
    const schedule = await createSchedule(database, {
      originClientInstanceId: clientId,
      title: "Paginated history",
      cronExpression: "* * * * *",
      timezone: "UTC",
      requestSchemaId: "radius.agent-task",
      requestSchemaVersion: 1,
      request: { prompt: "Keep history bounded" },
      now,
    });
    for (let offset = 1; offset <= 3; offset += 1) {
      await materializeScheduledRun(database, {
        schedule,
        scheduledForMs: now + offset * 60_000,
        now,
      });
    }

    const firstPage = await listScheduledRuns(database, schedule.id, {
      limit: 2,
    });
    const secondPage = await listScheduledRuns(database, schedule.id, {
      afterScheduledForMs: firstPage.at(-1)!.scheduledForMs,
      limit: 2,
    });
    assert.equal(firstPage.length, 2);
    assert.equal(secondPage.length, 1);
    assert.ok(secondPage[0]!.scheduledForMs > firstPage[1]!.scheduledForMs);
  });
});
