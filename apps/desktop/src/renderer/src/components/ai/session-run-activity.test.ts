import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_RUN_ACTIVITY_DETAIL,
  type SessionTranscriptEvent,
} from "../../../../radius-api";
import { deriveWorkingRunActivity } from "./session-run-activity";

const base = {
  agentRunId: "run-1",
  occurredAt: "2026-08-30T18:00:00.000Z",
  sessionRevision: 4,
};

function toolCall(
  eventId: string,
  capability: string,
  operation: string,
): Extract<SessionTranscriptEvent, { eventType: "tool_call" }> {
  return {
    ...base,
    eventId,
    eventType: "tool_call",
    capability,
    operation,
    inputSchemaId: "test.tool",
    inputSchemaVersion: 1,
    input: null,
  };
}

function toolResult(
  eventId: string,
  toolCallEventId: string,
): Extract<SessionTranscriptEvent, { eventType: "tool_result" }> {
  return {
    ...base,
    eventId,
    eventType: "tool_result",
    toolCallEventId,
    outcome: "succeeded",
    outputSchemaId: "test.result",
    outputSchemaVersion: 1,
    output: null,
  };
}

test("shows trusted startup states without exposing arbitrary run detail", () => {
  const startup: SessionTranscriptEvent = {
    ...base,
    eventId: "startup",
    eventType: "agent_run_state_update",
    state: "working",
    detail: SESSION_RUN_ACTIVITY_DETAIL.startingFxAgent,
  };
  assert.deepEqual(deriveWorkingRunActivity([startup], false), {
    key: "starting-agent",
    label: "Starting local agent",
  });

  const providerDetail: SessionTranscriptEvent = {
    ...startup,
    eventId: "provider-detail",
    detail: "Reading /Users/example/private.txt",
  };
  assert.deepEqual(deriveWorkingRunActivity([providerDetail], false), {
    key: "thinking",
    label: "Thinking",
  });
});

test("uses the latest agent-provided tool title and returns to response streaming", () => {
  const command = toolCall("command", "shell", "execute");
  assert.deepEqual(deriveWorkingRunActivity([command], false), {
    key: "tool:command",
    label: "execute",
  });

  assert.deepEqual(
    deriveWorkingRunActivity(
      [command, toolResult("command-result", command.eventId)],
      true,
    ),
    { key: "writing-response", label: "Writing response" },
  );
});

test("keeps an earlier concurrent tool visible when a newer tool finishes", () => {
  const search = toolCall("search", "acp.search", "Search");
  const fetch = toolCall("fetch", "acp.fetch", "Fetch");
  assert.deepEqual(
    deriveWorkingRunActivity(
      [search, fetch, toolResult("fetch-result", fetch.eventId)],
      false,
    ),
    { key: "tool:search", label: "Search" },
  );
});

test("does not replace an ACP tool title with a client-authored category", () => {
  assert.equal(
    deriveWorkingRunActivity(
      [toolCall("read", "acp.read", "Reading memory.md")],
      false,
    ).label,
    "Reading memory.md",
  );
});
