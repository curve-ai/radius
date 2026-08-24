import {
  listScheduleReconciliationStates,
  materializeScheduledRun,
  type RadiusDatabase,
  type ScheduleRecord,
} from "@curve-ai/radius-storage";

import { scanOccurrences, type OccurrenceScan } from "./recurrence.js";
import { nextOccurrenceAt } from "./recurrence.js";

export interface ReconciliationResult {
  schedulesChecked: number;
  runsInserted: number;
  nextOccurrenceAtMs: number | null;
}

async function materializeCoalesced(
  database: RadiusDatabase,
  schedule: ScheduleRecord,
  occurrences: Pick<OccurrenceScan, "count" | "first" | "last">,
  options: {
    state: "pending" | "skipped";
    availableAtMs: number | null;
    now: number;
  },
): Promise<number> {
  const { count, first, last } = occurrences;
  if (count === 0 || first === null || last === null) return 0;
  const result = await materializeScheduledRun(database, {
    schedule,
    scheduledForMs: first,
    coalescedThroughMs: last,
    coalescedOccurrenceCount: count,
    ...options,
  });
  return result.inserted ? 1 : 0;
}

async function reconcileSchedule(
  database: RadiusDatabase,
  schedule: ScheduleRecord,
  afterMs: number,
  now: number,
): Promise<number> {
  const occurrences = await scanOccurrences(
    schedule,
    afterMs,
    now,
    schedule.missedRunPolicy === "replay_all" ? schedule.replayLimit : 0,
  );
  if (occurrences.count === 0) return 0;

  if (schedule.missedRunPolicy === "skip") {
    return materializeCoalesced(database, schedule, occurrences, {
      state: "skipped",
      availableAtMs: null,
      now,
    });
  }

  if (schedule.missedRunPolicy === "ask") {
    return materializeCoalesced(database, schedule, occurrences, {
      state: "pending",
      availableAtMs: null,
      now,
    });
  }

  if (schedule.missedRunPolicy === "catch_up_once") {
    const latestOccurrence = occurrences.last!;
    const expired = now - latestOccurrence > schedule.maxCatchUpAgeMs;
    return materializeCoalesced(database, schedule, occurrences, {
      state: expired ? "skipped" : "pending",
      availableAtMs: expired ? null : now,
      now,
    });
  }

  let inserted = 0;
  for (const scheduledForMs of occurrences.replay) {
    const result = await materializeScheduledRun(database, {
      schedule,
      scheduledForMs,
      state: "pending",
      availableAtMs: now,
      now,
    });
    if (result.inserted) inserted += 1;
  }
  const remainderCount = occurrences.count - occurrences.replay.length;
  return (
    inserted +
    (await materializeCoalesced(
      database,
      schedule,
      {
        count: remainderCount,
        first: occurrences.remainderFirst,
        last: remainderCount > 0 ? occurrences.last : null,
      },
      {
        state: "skipped",
        availableAtMs: null,
        now,
      },
    ))
  );
}

export async function reconcileSchedules(
  database: RadiusDatabase,
  now = Date.now(),
): Promise<ReconciliationResult> {
  const states = await listScheduleReconciliationStates(database);
  let runsInserted = 0;
  let nextOccurrenceAtMs: number | null = null;
  for (const state of states) {
    const { schedule } = state;
    runsInserted += await reconcileSchedule(
      database,
      schedule,
      state.latestCoalescedThroughMs ?? schedule.updatedAtMs,
      now,
    );
    const next = nextOccurrenceAt(schedule, now);
    nextOccurrenceAtMs =
      nextOccurrenceAtMs === null ? next : Math.min(nextOccurrenceAtMs, next);
  }
  return {
    schedulesChecked: states.length,
    runsInserted,
    nextOccurrenceAtMs,
  };
}
