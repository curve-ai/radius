import assert from "node:assert/strict";
import test from "node:test";

import { messageTimestampPresentation } from "./message-timestamp.js";

const options = {
  locale: "en-US",
  now: new Date("2026-09-01T16:00:00.000Z"),
  timeZone: "America/New_York",
};

test("shows only the time for a message from today", () => {
  assert.deepEqual(
    messageTimestampPresentation("2026-09-01T15:20:00.000Z", options),
    {
      dateTime: "2026-09-01T15:20:00.000Z",
      displayLabel: "11:20 AM",
      fullLabel: "Sep 1, 2026, 11:20 AM",
    },
  );
});

test("shows weekday and time earlier in the current week", () => {
  assert.equal(
    messageTimestampPresentation("2026-08-31T13:03:00.000Z", options)
      ?.displayLabel,
    "Monday 9:03 AM",
  );
});

test("shows abbreviated month and day before the current week", () => {
  assert.equal(
    messageTimestampPresentation("2026-08-24T15:20:00.000Z", options)
      ?.displayLabel,
    "Aug, 24 11:20 AM",
  );
});

test("shows a numeric date for messages from a prior year", () => {
  assert.equal(
    messageTimestampPresentation("2025-08-24T15:20:00.000Z", options)
      ?.displayLabel,
    "08/24/25 11:20 AM",
  );
});

test("omits malformed message timestamps", () => {
  assert.equal(messageTimestampPresentation("not-a-date"), null);
});
