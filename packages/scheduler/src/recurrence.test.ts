import assert from "node:assert/strict";
import test from "node:test";

import {
  nextOccurrenceAt,
  occurrencesBetween,
  validateRecurrence,
} from "./recurrence.js";

test("validates five-field cron expressions and IANA timezones", () => {
  assert.doesNotThrow(() =>
    validateRecurrence("30 9 * * 1-5", "America/New_York"),
  );
  assert.throws(
    () => validateRecurrence("0 30 9 * * 1-5", "America/New_York"),
    /five-field/,
  );
  assert.throws(
    () => validateRecurrence("30 9 * * 1-5", "Not/A_Zone"),
    /Invalid IANA timezone/,
  );
});

test("calculates wall-clock occurrences across daylight-saving changes", () => {
  const schedule = {
    cronExpression: "30 9 * * *",
    timezone: "America/New_York",
  };
  assert.equal(
    nextOccurrenceAt(schedule, Date.parse("2026-03-07T15:00:00.000Z")),
    Date.parse("2026-03-08T13:30:00.000Z"),
  );
  assert.deepEqual(
    occurrencesBetween(
      schedule,
      Date.parse("2026-03-07T14:29:00.000Z"),
      Date.parse("2026-03-09T13:31:00.000Z"),
    ),
    [
      Date.parse("2026-03-07T14:30:00.000Z"),
      Date.parse("2026-03-08T13:30:00.000Z"),
      Date.parse("2026-03-09T13:30:00.000Z"),
    ],
  );
});
