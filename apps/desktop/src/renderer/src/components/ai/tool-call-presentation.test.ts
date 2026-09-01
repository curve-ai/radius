import assert from "node:assert/strict";
import test from "node:test";

import type { SessionTranscriptEvent } from "../../../../radius-api";
import { toolCallPresentation } from "./tool-call-presentation";

const base = {
  agentRunId: "run-1",
  occurredAt: "2026-09-01T12:00:00.000Z",
  sessionRevision: 1,
};

const call: Extract<SessionTranscriptEvent, { eventType: "tool_call" }> = {
  ...base,
  eventId: "call-1",
  eventType: "tool_call",
  capability: "acp.execute",
  operation: "Running checks",
  inputSchemaId: "acp.tool-call",
  inputSchemaVersion: 1,
  input: { command: "gh", args: ["run", "watch", "123"] },
};

test("uses the latest agent title and renders command output", () => {
  const progress: Extract<
    SessionTranscriptEvent,
    { eventType: "tool_progress" }
  >[] = [
    {
      ...base,
      eventId: "progress-1",
      eventType: "tool_progress",
      toolCallEventId: call.eventId,
      progressSchemaId: "acp.tool-progress",
      progressSchemaVersion: 1,
      progress: {
        status: "in_progress",
        title: "Watching CI checks",
        rawOutput: "Build complete\nAudit in progress",
      },
    },
  ];

  assert.deepEqual(toolCallPresentation(call, progress, undefined), {
    active: true,
    details: [
      {
        label: "Shell",
        text: "$ gh run watch 123\n\nBuild complete\nAudit in progress",
      },
    ],
    endedAt: null,
    failed: false,
    title: "Watching CI checks",
  });
});

test("uses the final result and keeps arbitrary structured payloads visible", () => {
  const result: Extract<SessionTranscriptEvent, { eventType: "tool_result" }> =
    {
      ...base,
      eventId: "result-1",
      occurredAt: "2026-09-01T12:00:03.000Z",
      eventType: "tool_result",
      toolCallEventId: call.eventId,
      outcome: "failed",
      outputSchemaId: "acp.tool-result",
      outputSchemaVersion: 1,
      output: { error: "Review required" },
    };

  const presentation = toolCallPresentation(
    { ...call, input: { query: "status" } },
    [],
    result,
  );
  assert.equal(presentation.active, false);
  assert.equal(presentation.failed, true);
  assert.equal(presentation.endedAt, result.occurredAt);
  assert.deepEqual(presentation.details, [
    { label: "Input", text: '{\n  "query": "status"\n}' },
    { label: "Output", text: '{\n  "error": "Review required"\n}' },
  ]);
});
