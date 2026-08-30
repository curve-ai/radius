import assert from "node:assert/strict";
import test from "node:test";

import type { SessionTranscriptEvent } from "../../../../radius-api";
import { sessionTranscriptAsMarkdown } from "./session-copy";

test("copies final conversation messages as readable Markdown", () => {
  const events = [
    {
      eventId: "user-1",
      sessionRevision: 1,
      occurredAt: "2026-08-29T12:00:00.000Z",
      agentRunId: null,
      eventType: "message",
      role: "user",
      messageKind: "final",
      status: "completed",
      text: "Build **this**.",
    },
    {
      eventId: "progress-1",
      sessionRevision: 2,
      occurredAt: "2026-08-29T12:00:01.000Z",
      agentRunId: "run-1",
      eventType: "message",
      role: "assistant",
      messageKind: "progress",
      status: "completed",
      text: "Working",
    },
    {
      eventId: "assistant-stream",
      sessionRevision: Number.MAX_SAFE_INTEGER,
      occurredAt: "2026-08-29T12:00:01.500Z",
      agentRunId: "run-1",
      eventType: "message",
      role: "assistant",
      messageKind: "final",
      status: "streaming",
      text: "Partially done...",
    },
    {
      eventId: "assistant-1",
      sessionRevision: 3,
      occurredAt: "2026-08-29T12:00:02.000Z",
      agentRunId: "run-1",
      eventType: "message",
      role: "assistant",
      messageKind: "final",
      status: "completed",
      text: "Done.",
    },
  ] satisfies SessionTranscriptEvent[];

  assert.equal(
    sessionTranscriptAsMarkdown("Example", events),
    "# Example\n\n## You\n\nBuild **this**.\n\n## Assistant\n\nDone.",
  );
});
