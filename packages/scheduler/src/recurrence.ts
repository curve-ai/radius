import { CronExpressionParser } from "cron-parser";
import type { CronExpression } from "cron-parser";

import type { ScheduleRecord } from "@curve-ai/radius-storage";

const MAX_COLLECTED_OCCURRENCES = 100_000;
const YIELD_EVERY_OCCURRENCES = 1_000;

type Recurrence = Pick<ScheduleRecord, "cronExpression" | "timezone">;

export interface OccurrenceScan {
  count: number;
  first: number | null;
  last: number | null;
  replay: number[];
  remainderFirst: number | null;
}

function assertFiveFieldCron(expression: string): void {
  if (expression.trim().split(/\s+/).length !== 5) {
    throw new Error("Radius schedules require a five-field cron expression");
  }
}

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
}

function parseRecurrence(
  schedule: Recurrence,
  currentDate: number,
  endDate?: number,
): CronExpression {
  assertFiveFieldCron(schedule.cronExpression);
  assertTimezone(schedule.timezone);
  return CronExpressionParser.parse(schedule.cronExpression, {
    currentDate: new Date(currentDate),
    ...(endDate === undefined ? {} : { endDate: new Date(endDate) }),
    tz: schedule.timezone,
  });
}

export function validateRecurrence(
  cronExpression: string,
  timezone: string,
): void {
  parseRecurrence({ cronExpression, timezone }, 0);
}

export function nextOccurrenceAt(
  schedule: Recurrence,
  afterMs: number,
): number {
  return parseRecurrence(schedule, afterMs).next().toDate().getTime();
}

export function occurrencesBetween(
  schedule: Recurrence,
  afterMs: number,
  throughMs: number,
): number[] {
  if (throughMs <= afterMs) return [];
  const expression = parseRecurrence(schedule, afterMs, throughMs);
  const occurrences: number[] = [];
  while (expression.hasNext()) {
    if (occurrences.length >= MAX_COLLECTED_OCCURRENCES) {
      throw new Error("Collected occurrence limit exceeded");
    }
    occurrences.push(expression.next().toDate().getTime());
  }
  return occurrences;
}

export async function scanOccurrences(
  schedule: Recurrence,
  afterMs: number,
  throughMs: number,
  replayLimit = 0,
): Promise<OccurrenceScan> {
  if (throughMs <= afterMs) {
    return {
      count: 0,
      first: null,
      last: null,
      replay: [],
      remainderFirst: null,
    };
  }
  const expression = parseRecurrence(schedule, afterMs, throughMs);
  const replay: number[] = [];
  let count = 0;
  let first: number | null = null;
  let last: number | null = null;
  let remainderFirst: number | null = null;
  while (expression.hasNext()) {
    const occurrence = expression.next().toDate().getTime();
    count += 1;
    first ??= occurrence;
    last = occurrence;
    if (replay.length < replayLimit) replay.push(occurrence);
    else remainderFirst ??= occurrence;
    if (count % YIELD_EVERY_OCCURRENCES === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  return { count, first, last, replay, remainderFirst };
}
