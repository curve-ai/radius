import assert from "node:assert/strict";
import test from "node:test";

import type {
  SessionTranscriptEvent,
  SessionTranscriptStreamUpdate,
} from "../../../../radius-api";
import {
  mergeSessionTranscriptStreamUpdate,
  sameSessionTranscriptSnapshot,
} from "./session-stream";

function streamUpdate(
  text: string,
  event: SessionTranscriptStreamUpdate["event"] = {
    eventId: "assistant-stream",
    sessionRevision: Number.MAX_SAFE_INTEGER,
    occurredAt: "2026-08-29T12:00:00.000Z",
    agentRunId: "run-1",
    eventType: "message",
    role: "assistant",
    messageKind: "final",
    status: "streaming",
    text,
  },
  mode: SessionTranscriptStreamUpdate["mode"] = "replace",
  textOffset?: number,
): SessionTranscriptStreamUpdate {
  return {
    sessionId: "session-1",
    eventId: "assistant-stream",
    event,
    mode,
    textOffset,
  };
}

test("appends the first chunk and replaces later chunks in place", () => {
  const first = mergeSessionTranscriptStreamUpdate(
    [],
    streamUpdate("A", undefined, "append", 0),
  );
  const second = mergeSessionTranscriptStreamUpdate(
    first,
    streamUpdate(" table", undefined, "append", 1),
  );

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(
    (second[0] as Extract<SessionTranscriptEvent, { eventType: "message" }>)
      .text,
    "A table",
  );
});

test("removes only the matching transient event when a stream is cleared", () => {
  const existing: SessionTranscriptEvent = {
    eventId: "prompt",
    sessionRevision: 1,
    occurredAt: "2026-08-29T11:59:59.000Z",
    agentRunId: null,
    eventType: "message",
    role: "user",
    messageKind: "prompt",
    status: "completed",
    text: "Show a table",
  };
  const streaming = mergeSessionTranscriptStreamUpdate(
    [existing],
    streamUpdate("partial"),
  );
  const cleared = mergeSessionTranscriptStreamUpdate(
    streaming,
    streamUpdate("", null, "replace"),
  );

  assert.deepEqual(cleared, [existing]);
});

test("ignores a delta already included by a full snapshot recovery", () => {
  const current = mergeSessionTranscriptStreamUpdate(
    [],
    streamUpdate("A table", undefined, "replace"),
  );
  const duplicate = mergeSessionTranscriptStreamUpdate(
    current,
    streamUpdate(" table", undefined, "append", 1),
  );

  assert.strictEqual(duplicate, current);
});

test("detects message text changes in otherwise stable transcript snapshots", () => {
  const first = mergeSessionTranscriptStreamUpdate(
    [],
    streamUpdate("partial", undefined, "replace"),
  );
  const identical = first.map((event) => ({ ...event }));
  const changed = mergeSessionTranscriptStreamUpdate(
    first,
    streamUpdate("complete", undefined, "replace"),
  );

  assert.equal(sameSessionTranscriptSnapshot(first, identical), true);
  assert.equal(sameSessionTranscriptSnapshot(first, changed), false);
});

test("detects image artifacts added to an otherwise stable message", () => {
  const first = mergeSessionTranscriptStreamUpdate(
    [],
    streamUpdate("Generated an image", undefined, "replace"),
  );
  const withImage = first.map((event) =>
    event.eventType === "message"
      ? {
          ...event,
          artifacts: [
            {
              id: "image-1",
              name: "generated.png",
              artifactType: "image" as const,
              storageKind: "file" as const,
              mimeType: "image/png",
              availability: "local" as const,
              url: null,
            },
          ],
        }
      : event,
  );

  assert.equal(sameSessionTranscriptSnapshot(first, withImage), false);
});
