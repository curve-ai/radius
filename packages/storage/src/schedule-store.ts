import { randomUUID } from "node:crypto";

import type { JsonValue } from "@curve-ai/radius-sync-protocol";
import { and, asc, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";

import { canonicalJson } from "./canonical-json.js";
import type { RadiusDatabase } from "./database.js";
import { scheduledRuns, schedules } from "./schema.js";

export type ScheduleRecord = typeof schedules.$inferSelect;
export type ScheduledRunRecord = typeof scheduledRuns.$inferSelect;
export type MissedRunPolicy = ScheduleRecord["missedRunPolicy"];
export type ScheduledRunState = ScheduledRunRecord["state"];
export interface ScheduleReconciliationState {
  schedule: ScheduleRecord;
  latestCoalescedThroughMs: number | null;
}

export interface CreateScheduleInput {
  originClientInstanceId: string;
  title: string;
  cronExpression: string;
  timezone: string;
  missedRunPolicy?: MissedRunPolicy;
  maxCatchUpAgeMs?: number;
  replayLimit?: number;
  requestSchemaId: string;
  requestSchemaVersion: number;
  request: JsonValue;
  enabled?: boolean;
  now?: number;
}

export interface UpdateScheduleInput {
  title?: string;
  cronExpression?: string;
  timezone?: string;
  missedRunPolicy?: MissedRunPolicy;
  maxCatchUpAgeMs?: number;
  replayLimit?: number;
  requestSchemaId?: string;
  requestSchemaVersion?: number;
  request?: JsonValue;
  enabled?: boolean;
  now?: number;
}

export interface MaterializeScheduledRunInput {
  schedule: ScheduleRecord;
  scheduledForMs: number;
  coalescedThroughMs?: number;
  coalescedOccurrenceCount?: number;
  state?: "pending" | "skipped";
  availableAtMs?: number | null;
  now?: number;
}

export interface ListScheduledRunsOptions {
  afterScheduledForMs?: number;
  limit?: number;
}

export interface ClaimedScheduledRun extends ScheduledRunRecord {
  state: "leased";
  leaseToken: string;
  leaseExpiresAtMs: number;
}

function nonempty(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} must not be empty`);
  return trimmed;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value;
}

export async function createSchedule(
  database: RadiusDatabase,
  input: CreateScheduleInput,
): Promise<ScheduleRecord> {
  const now = input.now ?? Date.now();
  const record: typeof schedules.$inferInsert = {
    id: randomUUID(),
    originClientInstanceId: input.originClientInstanceId,
    title: nonempty(input.title, "Schedule title"),
    cronExpression: nonempty(input.cronExpression, "Cron expression"),
    timezone: nonempty(input.timezone, "Timezone"),
    missedRunPolicy: input.missedRunPolicy ?? "catch_up_once",
    maxCatchUpAgeMs: nonnegativeInteger(
      input.maxCatchUpAgeMs ?? 86_400_000,
      "Maximum catch-up age",
    ),
    replayLimit: positiveInteger(input.replayLimit ?? 20, "Replay limit"),
    requestSchemaId: nonempty(input.requestSchemaId, "Request schema ID"),
    requestSchemaVersion: positiveInteger(
      input.requestSchemaVersion,
      "Request schema version",
    ),
    requestJson: canonicalJson(input.request),
    enabled: input.enabled ?? true,
    revision: 1,
    createdAtMs: now,
    updatedAtMs: now,
  };

  const [created] = await database.db
    .insert(schedules)
    .values(record)
    .returning();
  if (!created) throw new Error("Schedule insert returned no row");
  return created;
}

export async function updateSchedule(
  database: RadiusDatabase,
  scheduleId: string,
  input: UpdateScheduleInput,
): Promise<ScheduleRecord> {
  const [existing] = await database.db
    .select()
    .from(schedules)
    .where(and(eq(schedules.id, scheduleId), isNull(schedules.deletedAtMs)))
    .limit(1);
  if (!existing) throw new Error("Schedule does not exist");

  const [updated] = await database.db
    .update(schedules)
    .set({
      title:
        input.title === undefined
          ? existing.title
          : nonempty(input.title, "Schedule title"),
      cronExpression:
        input.cronExpression === undefined
          ? existing.cronExpression
          : nonempty(input.cronExpression, "Cron expression"),
      timezone:
        input.timezone === undefined
          ? existing.timezone
          : nonempty(input.timezone, "Timezone"),
      missedRunPolicy: input.missedRunPolicy ?? existing.missedRunPolicy,
      maxCatchUpAgeMs:
        input.maxCatchUpAgeMs === undefined
          ? existing.maxCatchUpAgeMs
          : nonnegativeInteger(input.maxCatchUpAgeMs, "Maximum catch-up age"),
      replayLimit:
        input.replayLimit === undefined
          ? existing.replayLimit
          : positiveInteger(input.replayLimit, "Replay limit"),
      requestSchemaId:
        input.requestSchemaId === undefined
          ? existing.requestSchemaId
          : nonempty(input.requestSchemaId, "Request schema ID"),
      requestSchemaVersion:
        input.requestSchemaVersion === undefined
          ? existing.requestSchemaVersion
          : positiveInteger(
              input.requestSchemaVersion,
              "Request schema version",
            ),
      requestJson:
        input.request === undefined
          ? existing.requestJson
          : canonicalJson(input.request),
      enabled: input.enabled ?? existing.enabled,
      revision: existing.revision + 1,
      updatedAtMs: input.now ?? Date.now(),
    })
    .where(
      and(
        eq(schedules.id, scheduleId),
        eq(schedules.revision, existing.revision),
      ),
    )
    .returning();
  if (!updated) throw new Error("Schedule changed concurrently");
  return updated;
}

export async function deleteSchedule(
  database: RadiusDatabase,
  scheduleId: string,
  now = Date.now(),
): Promise<boolean> {
  const updated = await database.db
    .update(schedules)
    .set({
      enabled: false,
      revision: sql`${schedules.revision} + 1`,
      deletedAtMs: now,
      updatedAtMs: now,
    })
    .where(and(eq(schedules.id, scheduleId), isNull(schedules.deletedAtMs)))
    .returning({ id: schedules.id });
  return updated.length === 1;
}

export async function listEnabledSchedules(
  database: RadiusDatabase,
): Promise<ScheduleRecord[]> {
  return database.db
    .select()
    .from(schedules)
    .where(and(eq(schedules.enabled, true), isNull(schedules.deletedAtMs)))
    .orderBy(asc(schedules.createdAtMs), asc(schedules.id));
}

export async function getSchedule(
  database: RadiusDatabase,
  scheduleId: string,
): Promise<ScheduleRecord | null> {
  const [record] = await database.db
    .select()
    .from(schedules)
    .where(and(eq(schedules.id, scheduleId), isNull(schedules.deletedAtMs)))
    .limit(1);
  return record ?? null;
}

export async function listScheduleReconciliationStates(
  database: RadiusDatabase,
): Promise<ScheduleReconciliationState[]> {
  return database.db
    .select({
      schedule: schedules,
      latestCoalescedThroughMs: sql<number | null>`(
        select max(${scheduledRuns.coalescedThroughMs})
        from ${scheduledRuns}
        where ${scheduledRuns.scheduleId} = ${schedules.id}
          and ${scheduledRuns.scheduleRevision} = ${schedules.revision}
      )`,
    })
    .from(schedules)
    .where(and(eq(schedules.enabled, true), isNull(schedules.deletedAtMs)))
    .orderBy(asc(schedules.createdAtMs), asc(schedules.id));
}

export async function getNextScheduledRunWakeAt(
  database: RadiusDatabase,
): Promise<number | null> {
  const [[pending], [leased]] = await Promise.all([
    database.db
      .select({ at: scheduledRuns.availableAtMs })
      .from(scheduledRuns)
      .where(
        and(
          eq(scheduledRuns.state, "pending"),
          isNotNull(scheduledRuns.availableAtMs),
          isNull(scheduledRuns.finishedAtMs),
        ),
      )
      .orderBy(asc(scheduledRuns.availableAtMs))
      .limit(1),
    database.db
      .select({ at: scheduledRuns.leaseExpiresAtMs })
      .from(scheduledRuns)
      .where(
        and(
          eq(scheduledRuns.state, "leased"),
          isNotNull(scheduledRuns.leaseExpiresAtMs),
        ),
      )
      .orderBy(asc(scheduledRuns.leaseExpiresAtMs))
      .limit(1),
  ]);
  const candidates = [pending?.at, leased?.at].filter(
    (value): value is number => value !== null && value !== undefined,
  );
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

export async function materializeScheduledRun(
  database: RadiusDatabase,
  input: MaterializeScheduledRunInput,
): Promise<{ inserted: boolean; run: ScheduledRunRecord }> {
  const now = input.now ?? Date.now();
  const scheduledForMs = nonnegativeInteger(
    input.scheduledForMs,
    "Scheduled time",
  );
  const coalescedThroughMs = nonnegativeInteger(
    input.coalescedThroughMs ?? scheduledForMs,
    "Coalesced-through time",
  );
  if (coalescedThroughMs < scheduledForMs) {
    throw new Error("Coalesced-through time must not precede scheduled time");
  }
  const coalescedOccurrenceCount = positiveInteger(
    input.coalescedOccurrenceCount ?? 1,
    "Coalesced occurrence count",
  );
  const state = input.state ?? "pending";
  const finishedAtMs = state === "skipped" ? now : null;
  const availableAtMs =
    state === "pending"
      ? input.availableAtMs === undefined
        ? now
        : input.availableAtMs
      : null;

  const [created] = await database.db
    .insert(scheduledRuns)
    .values({
      id: randomUUID(),
      scheduleId: input.schedule.id,
      scheduleRevision: input.schedule.revision,
      scheduledForMs,
      coalescedThroughMs,
      coalescedOccurrenceCount,
      requestSchemaId: input.schedule.requestSchemaId,
      requestSchemaVersion: input.schedule.requestSchemaVersion,
      requestJson: input.schedule.requestJson,
      state,
      attemptCount: 0,
      availableAtMs,
      createdAtMs: now,
      finishedAtMs,
    })
    .onConflictDoNothing({
      target: [scheduledRuns.scheduleId, scheduledRuns.scheduledForMs],
    })
    .returning();
  if (created) return { inserted: true, run: created };

  const [existing] = await database.db
    .select()
    .from(scheduledRuns)
    .where(
      and(
        eq(scheduledRuns.scheduleId, input.schedule.id),
        eq(scheduledRuns.scheduledForMs, scheduledForMs),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Scheduled run conflict returned no row");
  return { inserted: false, run: existing };
}

export async function claimScheduledRun(
  database: RadiusDatabase,
  options: { now?: number; leaseDurationMs: number },
): Promise<ClaimedScheduledRun | null> {
  const now = options.now ?? Date.now();
  const leaseDurationMs = positiveInteger(
    options.leaseDurationMs,
    "Lease duration",
  );

  return database.db.transaction(async (tx) => {
    const ready = or(
      and(
        eq(scheduledRuns.state, "pending"),
        lte(scheduledRuns.availableAtMs, now),
      ),
      and(
        eq(scheduledRuns.state, "leased"),
        lte(scheduledRuns.leaseExpiresAtMs, now),
      ),
    );
    const [candidate] = await tx
      .select()
      .from(scheduledRuns)
      .where(ready)
      .orderBy(
        asc(scheduledRuns.availableAtMs),
        asc(scheduledRuns.scheduledForMs),
      )
      .limit(1);
    if (!candidate) return null;

    const leaseToken = randomUUID();
    const leaseExpiresAtMs = now + leaseDurationMs;
    const [claimed] = await tx
      .update(scheduledRuns)
      .set({
        state: "leased",
        attemptCount: candidate.attemptCount + 1,
        leaseToken,
        leaseExpiresAtMs,
        startedAtMs: candidate.startedAtMs ?? now,
        finishedAtMs: null,
      })
      .where(and(eq(scheduledRuns.id, candidate.id), ready))
      .returning();
    if (!claimed) return null;
    return claimed as ClaimedScheduledRun;
  });
}

export async function heartbeatScheduledRun(
  database: RadiusDatabase,
  runId: string,
  leaseToken: string,
  leaseExpiresAtMs: number,
): Promise<boolean> {
  const updated = await database.db
    .update(scheduledRuns)
    .set({ leaseExpiresAtMs })
    .where(
      and(
        eq(scheduledRuns.id, runId),
        eq(scheduledRuns.state, "leased"),
        eq(scheduledRuns.leaseToken, leaseToken),
      ),
    )
    .returning({ id: scheduledRuns.id });
  return updated.length === 1;
}

export async function markScheduledRunDispatched(
  database: RadiusDatabase,
  runId: string,
  leaseToken: string,
  sessionId: string | null,
): Promise<boolean> {
  const updated = await database.db
    .update(scheduledRuns)
    .set({
      state: "dispatched",
      leaseToken: null,
      leaseExpiresAtMs: null,
      availableAtMs: null,
      sessionId,
      lastErrorCode: null,
    })
    .where(
      and(
        eq(scheduledRuns.id, runId),
        eq(scheduledRuns.state, "leased"),
        eq(scheduledRuns.leaseToken, leaseToken),
      ),
    )
    .returning({ id: scheduledRuns.id });
  return updated.length === 1;
}

export async function retryScheduledRun(
  database: RadiusDatabase,
  runId: string,
  leaseToken: string,
  input: { availableAtMs: number; errorCode: string },
): Promise<boolean> {
  const updated = await database.db
    .update(scheduledRuns)
    .set({
      state: "pending",
      availableAtMs: input.availableAtMs,
      leaseToken: null,
      leaseExpiresAtMs: null,
      lastErrorCode: nonempty(input.errorCode, "Error code"),
    })
    .where(
      and(
        eq(scheduledRuns.id, runId),
        eq(scheduledRuns.state, "leased"),
        eq(scheduledRuns.leaseToken, leaseToken),
      ),
    )
    .returning({ id: scheduledRuns.id });
  return updated.length === 1;
}

export async function failScheduledRun(
  database: RadiusDatabase,
  runId: string,
  leaseToken: string,
  input: { errorCode: string; now?: number },
): Promise<boolean> {
  const updated = await database.db
    .update(scheduledRuns)
    .set({
      state: "failed",
      availableAtMs: null,
      leaseToken: null,
      leaseExpiresAtMs: null,
      finishedAtMs: input.now ?? Date.now(),
      lastErrorCode: nonempty(input.errorCode, "Error code"),
    })
    .where(
      and(
        eq(scheduledRuns.id, runId),
        eq(scheduledRuns.state, "leased"),
        eq(scheduledRuns.leaseToken, leaseToken),
      ),
    )
    .returning({ id: scheduledRuns.id });
  return updated.length === 1;
}

export async function releaseScheduledRun(
  database: RadiusDatabase,
  runId: string,
  now = Date.now(),
): Promise<boolean> {
  const updated = await database.db
    .update(scheduledRuns)
    .set({ availableAtMs: now })
    .where(
      and(
        eq(scheduledRuns.id, runId),
        eq(scheduledRuns.state, "pending"),
        isNull(scheduledRuns.availableAtMs),
      ),
    )
    .returning({ id: scheduledRuns.id });
  return updated.length === 1;
}

export async function finishScheduledRun(
  database: RadiusDatabase,
  runId: string,
  state: "completed" | "failed" | "cancelled",
  options: { now?: number; errorCode?: string | null } = {},
): Promise<boolean> {
  const updated = await database.db
    .update(scheduledRuns)
    .set({
      state,
      finishedAtMs: options.now ?? Date.now(),
      lastErrorCode: options.errorCode ?? null,
    })
    .where(
      and(eq(scheduledRuns.id, runId), eq(scheduledRuns.state, "dispatched")),
    )
    .returning({ id: scheduledRuns.id });
  return updated.length === 1;
}

export async function listScheduledRuns(
  database: RadiusDatabase,
  scheduleId: string,
  options: ListScheduledRunsOptions = {},
): Promise<ScheduledRunRecord[]> {
  const limit = Math.min(
    positiveInteger(options.limit ?? 100, "Run limit"),
    500,
  );
  return database.db
    .select()
    .from(scheduledRuns)
    .where(
      and(
        eq(scheduledRuns.scheduleId, scheduleId),
        options.afterScheduledForMs === undefined
          ? undefined
          : gt(
              scheduledRuns.scheduledForMs,
              nonnegativeInteger(options.afterScheduledForMs, "Run cursor"),
            ),
      ),
    )
    .orderBy(asc(scheduledRuns.scheduledForMs))
    .limit(limit);
}
