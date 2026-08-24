import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  clientInstances,
  createSchedule,
  listScheduledRuns,
  migrateRadiusDatabase,
  openRadiusDatabase,
  type RadiusDatabase,
  updateSchedule,
} from "@curve-ai/radius-storage";

import { createLocalScheduler } from "./coordinator.js";

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
  const directory = await mkdtemp(path.join(tmpdir(), "radius-coordinator-"));
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

test("reconciles and durably dispatches a due run", async () => {
  await withDatabase(async (database) => {
    const createdAt = Date.parse("2026-08-22T08:00:00.000Z");
    const currentTime = Date.parse("2026-08-22T09:00:00.000Z");
    const schedule = await createSchedule(database, {
      originClientInstanceId: clientId,
      title: "Dispatch",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      requestSchemaId: "radius.agent-task",
      requestSchemaVersion: 1,
      request: { prompt: "Dispatch me" },
      now: createdAt,
    });
    const dispatched: string[] = [];
    const scheduler = createLocalScheduler({
      database,
      now: () => currentTime,
      executor: {
        async dispatch(run) {
          dispatched.push(run.id);
          return { sessionId: null };
        },
      },
    });

    await scheduler.start();
    await scheduler.stop();

    assert.equal(dispatched.length, 1);
    const [run] = await listScheduledRuns(database, schedule.id);
    assert.equal(run?.id, dispatched[0]);
    assert.equal(run?.state, "dispatched");
    assert.equal(run?.attemptCount, 1);
    assert.equal(run?.leaseToken, null);
  });
});

test("reconciles without claiming when no runtime executor is installed", async () => {
  await withDatabase(async (database) => {
    const createdAt = Date.parse("2026-08-22T08:00:00.000Z");
    const currentTime = Date.parse("2026-08-22T09:00:00.000Z");
    const schedule = await createSchedule(database, {
      originClientInstanceId: clientId,
      title: "Await runtime",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      requestSchemaId: "radius.agent-task",
      requestSchemaVersion: 1,
      request: { prompt: "Wait safely" },
      now: createdAt,
    });
    const scheduler = createLocalScheduler({
      database,
      now: () => currentTime,
    });

    await scheduler.start();
    await scheduler.stop();

    const [run] = await listScheduledRuns(database, schedule.id);
    assert.equal(run?.state, "pending");
    assert.equal(run?.attemptCount, 0);
  });
});

test("moves terminal dispatch failures out of the claim queue", async () => {
  await withDatabase(async (database) => {
    const createdAt = Date.parse("2026-08-22T08:00:00.000Z");
    const currentTime = Date.parse("2026-08-22T09:00:00.000Z");
    const schedule = await createSchedule(database, {
      originClientInstanceId: clientId,
      title: "Failing dispatch",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      requestSchemaId: "radius.agent-task",
      requestSchemaVersion: 1,
      request: { prompt: "Fail visibly" },
      now: createdAt,
    });
    const scheduler = createLocalScheduler({
      database,
      now: () => currentTime,
      maxDispatchAttempts: 1,
      executor: {
        async dispatch() {
          throw new Error("RUNTIME_UNAVAILABLE");
        },
      },
    });

    await scheduler.start();
    await scheduler.stop();

    const [run] = await listScheduledRuns(database, schedule.id);
    assert.equal(run?.state, "failed");
    assert.equal(run?.lastErrorCode, "RUNTIME_UNAVAILABLE");
    assert.equal(run?.finishedAtMs, currentTime);
  });
});

test("reports recurrence errors and recovers on a later wake", async () => {
  await withDatabase(async (database) => {
    const currentTime = Date.parse("2026-08-22T09:00:00.000Z");
    const schedule = await createSchedule(database, {
      originClientInstanceId: clientId,
      title: "Repairable",
      cronExpression: "not-a-cron",
      timezone: "UTC",
      requestSchemaId: "radius.agent-task",
      requestSchemaVersion: 1,
      request: { prompt: "Recover after correction" },
      now: currentTime - 120_000,
    });
    const errors: unknown[] = [];
    const scheduler = createLocalScheduler({
      database,
      now: () => currentTime,
      onError: (error) => errors.push(error),
    });

    await scheduler.start();
    assert.ok(errors.length >= 1);
    await updateSchedule(database, schedule.id, {
      cronExpression: "* * * * *",
      now: currentTime - 60_000,
    });
    await scheduler.wake();
    await scheduler.stop();

    const [run] = await listScheduledRuns(database, schedule.id);
    assert.equal(run?.state, "pending");
    assert.equal(run?.scheduledForMs, currentTime);
  });
});
