import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { SessionTranscriptEvent } from "../../../../radius-api";
import { TooltipProvider } from "@renderer/components/ui/tooltip";
import { SessionThread } from "./session-thread";

Object.assign(globalThis, { React });

const base = {
  agentRunId: "run-1",
  occurredAt: "2026-09-01T12:00:00.000Z",
  sessionRevision: 2,
};

test("keeps commentary, command disclosures, and final prose in agent order", () => {
  const events: SessionTranscriptEvent[] = [
    {
      ...base,
      eventId: "run",
      eventType: "agent_run",
      providerKey: "test-agent",
    },
    {
      ...base,
      eventId: "working",
      eventType: "agent_run_state_update",
      state: "working",
      detail: null,
    },
    {
      ...base,
      eventId: "commentary",
      eventType: "message",
      role: "assistant",
      messageKind: "progress",
      status: "completed",
      text: "I am checking the current CI run.",
    },
    {
      ...base,
      eventId: "command",
      eventType: "tool_call",
      capability: "acp.execute",
      operation: "Watching CI checks",
      inputSchemaId: "acp.tool-call",
      inputSchemaVersion: 1,
      input: { command: "gh", args: ["run", "watch", "123"] },
    },
    {
      ...base,
      eventId: "command-progress",
      eventType: "tool_progress",
      toolCallEventId: "command",
      progressSchemaId: "acp.tool-progress",
      progressSchemaVersion: 1,
      progress: { rawOutput: "Build complete" },
    },
    {
      ...base,
      eventId: "command-result",
      occurredAt: "2026-09-01T12:00:03.000Z",
      eventType: "tool_result",
      toolCallEventId: "command",
      outcome: "succeeded",
      outputSchemaId: "acp.tool-result",
      outputSchemaVersion: 1,
      output: "Build complete",
    },
    {
      ...base,
      eventId: "completed",
      occurredAt: "2026-09-01T12:00:04.000Z",
      eventType: "agent_run_state_update",
      state: "completed",
      detail: null,
    },
    {
      ...base,
      eventId: "final",
      occurredAt: "2026-09-01T12:00:04.000Z",
      eventType: "message",
      role: "assistant",
      messageKind: "final",
      status: "completed",
      text: "The checks passed.",
    },
  ];

  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SessionThread, {
        events,
        onResolveTerminalApproval: async () => undefined,
        planPresentation: {
          activePlan: null,
          completedPlanByMessageEventId: new Map(),
        },
        sessionId: "session-1",
      }),
    ),
  );

  const commentary = html.indexOf("I am checking the current CI run.");
  const command = html.indexOf("Watching CI checks");
  const final = html.indexOf("The checks passed.");
  assert.ok(commentary >= 0);
  assert.ok(command > commentary);
  assert.ok(final > command);
  assert.match(html, /\$ gh run watch 123/);
  assert.match(html, /Build complete/);
  assert.match(html, /data-tool-call-id="command"/);
});
