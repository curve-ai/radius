import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { SessionTranscriptEvent } from "../../../../radius-api";
import { TerminalApproval } from "./terminal-approval";

const base = {
  agentRunId: "run-1",
  occurredAt: "2026-08-29T20:00:00.000Z",
  sessionRevision: 3,
};

test("shows the exact command and external folder approval", () => {
  const toolCall: Extract<SessionTranscriptEvent, { eventType: "tool_call" }> =
    {
      ...base,
      eventId: "tool-call",
      eventType: "tool_call",
      capability: "shell",
      operation: "execute",
      inputSchemaId: "radius.shell.execute",
      inputSchemaVersion: 1,
      input: {
        command: "/bin/zsh",
        args: ["-f", "-c", "python build.py"],
        cwd: "/Volumes/Shared/Statements",
        environment: [],
        outsideProjectRoots: true,
        pendingLocally: true,
      },
    };
  const request: Extract<
    SessionTranscriptEvent,
    { eventType: "approval_request" }
  > = {
    ...base,
    eventId: "approval",
    eventType: "approval_request",
    toolCallEventId: toolCall.eventId,
    reason: "Allow this command to read and write the selected folder",
    expiresAt: "2026-08-29T20:10:00.000Z",
  };

  const html = renderToStaticMarkup(
    createElement(TerminalApproval, {
      request,
      toolCall,
      onResolve: async () => undefined,
    }),
  );
  assert.match(html, /Command approval required/);
  assert.match(html, /outside the project folders/);
  assert.match(html, /python build\.py/);
  assert.match(html, /Volumes\/Shared\/Statements/);
  assert.match(html, /Allow once/);
  assert.match(html, /Deny/);
});

test("shows an exact external file request", () => {
  const toolCall: Extract<SessionTranscriptEvent, { eventType: "tool_call" }> =
    {
      ...base,
      eventId: "file-call",
      eventType: "tool_call",
      capability: "workspace.files",
      operation: "read",
      inputSchemaId: "radius.workspace.files.read",
      inputSchemaVersion: 1,
      input: {
        path: "/Volumes/Shared/report.txt",
        outsideProjectRoots: true,
        pendingLocally: true,
      },
    };
  const request: Extract<
    SessionTranscriptEvent,
    { eventType: "approval_request" }
  > = {
    ...base,
    eventId: "file-approval",
    eventType: "approval_request",
    toolCallEventId: toolCall.eventId,
    reason: "Allow Radius to read the selected file",
    expiresAt: null,
  };
  const html = renderToStaticMarkup(
    createElement(TerminalApproval, {
      request,
      toolCall,
      onResolve: async () => undefined,
    }),
  );
  assert.match(html, /File access required/);
  assert.match(html, /permission to read a file outside/);
  assert.match(html, /Volumes\/Shared\/report\.txt/);
});
