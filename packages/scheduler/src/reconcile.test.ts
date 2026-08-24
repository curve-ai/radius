import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createSchedule,
  listScheduledRuns,
  migrateRadiusDatabase,
  openRadiusDatabase,
  type RadiusDatabase,
} from "@curve-ai/radius-storage";
import { clientInstances } from "@curve-ai/radius-storage";

import { reconcileSchedules } from "./reconcile.js";

const migrationsFolder = fileURLToPath(
  new URL("../../storage/drizzle", import.meta.url),
);

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
const clientId = "19353755-3c5e-4529-b58d-c74dacf7b68d";

async function withDatabase(
  callback: (database: RadiusDatabase) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "radius-reconcile-"));
  const database = await openRadiusDatabase({
    path: path.join(directory, "radius.db"),
  });
  try {
    await migrateRadiusDatabase(database, migrationsFolder);
    const now = Date.parse("2026-08-22T08:00:00.000Z");
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

test("coalesces missed occurrences once and reconciliation is idempotent", async () => {
  await withDatabase(async (database) => {
    const createdAt = Date.parse("2026-08-22T08:00:00.000Z");
    const now = Date.parse("2026-08-22T12:30:00.000Z");
    const schedule = await createSchedule(database, {
      originClientInstanceId: clientId,
      title: "Hourly",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      requestSchemaId: "radius.agent-task",
      requestSchemaVersion: 1,
      request: { prompt: "Run once after wake" },
      now: createdAt,
    });

    assert.deepEqual(await reconcileSchedules(database, now), {
      schedulesChecked: 1,
      runsInserted: 1,
      nextOccurrenceAtMs: Date.parse("2026-08-22T13:00:00.000Z"),
    });
    const [run] = await listScheduledRuns(database, schedule.id);
    assert.equal(run?.scheduledForMs, Date.parse("2026-08-22T09:00:00.000Z"));
    assert.equal(
      run?.coalescedThroughMs,
      Date.parse("2026-08-22T12:00:00.000Z"),
    );
    assert.equal(run?.coalescedOccurrenceCount, 4);
    assert.equal(run?.state, "pending");

    assert.deepEqual(await reconcileSchedules(database, now), {
      schedulesChecked: 1,
      runsInserted: 0,
      nextOccurrenceAtMs: Date.parse("2026-08-22T13:00:00.000Z"),
    });
  });
});

test("keeps ask runs unavailable and caps replay-all materialization", async () => {
  await withDatabase(async (database) => {
    const createdAt = Date.parse("2026-08-22T08:00:00.000Z");
    const now = Date.parse("2026-08-22T12:30:00.000Z");
    const ask = await createSchedule(database, {
      originClientInstanceId: clientId,
      title: "Ask",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      missedRunPolicy: "ask",
      requestSchemaId: "radius.agent-task",
      requestSchemaVersion: 1,
      request: { prompt: "Ask first" },
      now: createdAt,
    });
    const replay = await createSchedule(database, {
      originClientInstanceId: clientId,
      title: "Replay",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      missedRunPolicy: "replay_all",
      replayLimit: 2,
      requestSchemaId: "radius.agent-task",
      requestSchemaVersion: 1,
      request: { prompt: "Replay safely" },
      now: createdAt,
    });

    await reconcileSchedules(database, now);
    const [askRun] = await listScheduledRuns(database, ask.id);
    assert.equal(askRun?.state, "pending");
    assert.equal(askRun?.availableAtMs, null);

    const replayRuns = await listScheduledRuns(database, replay.id);
    assert.equal(replayRuns.length, 3);
    assert.deepEqual(
      replayRuns.map((run) => run.state),
      ["pending", "pending", "skipped"],
    );
    assert.equal(replayRuns[2]?.coalescedOccurrenceCount, 2);
  });
});

test("reconciles more than 100,000 missed occurrences without failing", async () => {
  await withDatabase(async (database) => {
    const now = Date.parse("2026-08-22T12:30:00.000Z");
    const createdAt = now - 100_005 * 60_000;
    const schedule = await createSchedule(database, {
      originClientInstanceId: clientId,
      title: "Long offline period",
      cronExpression: "* * * * *",
      timezone: "UTC",
      missedRunPolicy: "skip",
      requestSchemaId: "radius.agent-task",
      requestSchemaVersion: 1,
      request: { prompt: "Skip the backlog" },
      now: createdAt,
    });

    await reconcileSchedules(database, now);
    const [run] = await listScheduledRuns(database, schedule.id);
    assert.equal(run?.state, "skipped");
    assert.equal(run?.coalescedOccurrenceCount, 100_005);
    assert.equal(run?.coalescedThroughMs, now);
  });
});
