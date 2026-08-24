import assert from "node:assert/strict";
import test from "node:test";

import { SessionEventRecordSchema, SyncChangeEnvelopeSchema } from "./index.js";

const ids = {
  change: "2e3f0363-bbbc-44f6-ac2b-4a4e7b16d54e",
  client: "19353755-3c5e-4529-b58d-c74dacf7b68d",
  event: "97c9a24c-5f06-4af0-8c7e-8fc31b2e8295",
  part: "bba137bb-ab7e-4661-8569-34a5c51a636d",
  project: "114464fb-c83e-4f9f-91f7-7e2d73bb7c44",
  session: "3d3f7df5-1dc4-4564-8f04-124df85a69b1",
};

test("accepts a typed message event", () => {
  const result = SessionEventRecordSchema.safeParse({
    eventId: ids.event,
    sessionId: ids.session,
    sessionRevision: 2,
    sourceClientInstanceId: ids.client,
    agentRunId: null,
    occurredAt: "2026-08-21T20:00:00.000Z",
    artifactLinks: [],
    eventType: "message",
    role: "assistant",
    messageKind: "final",
    status: "completed",
    model: "example-model",
    providerMessageId: null,
    finishReason: "stop",
    parts: [
      {
        id: ids.part,
        position: 0,
        partType: "text",
        text: "Done.",
      },
    ],
  });

  assert.equal(result.success, true);
});

test("supports provider-selected inline and collapsible run presentation", () => {
  const base = {
    eventId: ids.event,
    sessionId: ids.session,
    sessionRevision: 4,
    sourceClientInstanceId: ids.client,
    agentRunId: "445d951a-ff55-4eca-a032-a8a58d818d09",
    occurredAt: "2026-08-21T20:00:00.000Z",
    artifactLinks: [],
    eventType: "agent_run_presentation" as const,
    summaryMessageEventId: null,
    label: "Worked",
  };

  assert.equal(
    SessionEventRecordSchema.safeParse({
      ...base,
      mode: "inline",
      initialState: null,
    }).success,
    true,
  );
  assert.equal(
    SessionEventRecordSchema.safeParse({
      ...base,
      mode: "collapsible",
      initialState: "collapsed",
    }).success,
    true,
  );
  assert.equal(
    SessionEventRecordSchema.safeParse({
      ...base,
      mode: "collapsible",
      initialState: null,
    }).success,
    false,
  );
});

test("accepts a non-code project file creation without an absolute path", () => {
  const result = SessionEventRecordSchema.safeParse({
    eventId: ids.event,
    sessionId: ids.session,
    sessionRevision: 3,
    sourceClientInstanceId: ids.client,
    agentRunId: "445d951a-ff55-4eca-a032-a8a58d818d09",
    occurredAt: "2026-08-21T20:00:00.000Z",
    artifactLinks: [],
    eventType: "file_change",
    projectId: ids.project,
    projectFileId: "9d3f7df5-1dc4-4564-8f04-124df85a69b1",
    projectFileCreatedAt: "2026-08-21T20:00:00.000Z",
    toolCallEventId: null,
    operation: "create",
    beforeVersion: null,
    afterVersion: {
      id: "ad3f7df5-1dc4-4564-8f04-124df85a69b1",
      relativePath: "deliverables/customer-brief.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      contentSha256: "b".repeat(64),
      byteSize: 2048,
      capturedAt: "2026-08-21T20:00:00.000Z",
    },
    textDiff: null,
  });

  assert.equal(result.success, true);
});

test("rejects raw untyped event payloads", () => {
  const result = SessionEventRecordSchema.safeParse({
    eventId: ids.event,
    sessionId: ids.session,
    sessionRevision: 2,
    sourceClientInstanceId: ids.client,
    agentRunId: null,
    occurredAt: "2026-08-21T20:00:00.000Z",
    eventType: "message",
    payload: { text: "untyped" },
  });

  assert.equal(result.success, false);
});

test("requires a tombstone for session.delete", () => {
  const result = SyncChangeEnvelopeSchema.safeParse({
    protocolVersion: 1,
    changeId: ids.change,
    originClientInstanceId: ids.client,
    sessionId: ids.session,
    sessionRevision: 3,
    payloadSchemaVersion: 1,
    payloadSha256: "a".repeat(64),
    createdAt: "2026-08-21T20:00:00.000Z",
    kind: "session.delete",
    payload: {
      id: ids.session,
      originClientInstanceId: ids.client,
      projectId: null,
      title: "Test",
      status: "completed",
      revision: 3,
      createdAt: "2026-08-21T19:00:00.000Z",
      updatedAt: "2026-08-21T20:00:00.000Z",
      archivedAt: null,
      deletedAt: null,
    },
  });

  assert.equal(result.success, false);
});

test("accepts a typed project change without a local folder path", () => {
  const result = SyncChangeEnvelopeSchema.safeParse({
    protocolVersion: 1,
    changeId: ids.change,
    originClientInstanceId: ids.client,
    projectId: ids.project,
    projectRevision: 1,
    payloadSchemaVersion: 1,
    payloadSha256: "a".repeat(64),
    createdAt: "2026-08-21T20:00:00.000Z",
    kind: "project.upsert",
    payload: {
      id: ids.project,
      originClientInstanceId: ids.client,
      name: "agentic-workspace",
      revision: 1,
      createdAt: "2026-08-21T20:00:00.000Z",
      updatedAt: "2026-08-21T20:00:00.000Z",
      archivedAt: null,
      deletedAt: null,
    },
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal("rootPath" in result.data.payload, false);
  }
});

test("requires envelope identity and revision to match the payload", () => {
  const result = SyncChangeEnvelopeSchema.safeParse({
    protocolVersion: 1,
    changeId: ids.change,
    originClientInstanceId: ids.client,
    sessionId: "114464fb-c83e-4f9f-91f7-7e2d73bb7c44",
    sessionRevision: 2,
    payloadSchemaVersion: 1,
    payloadSha256: "a".repeat(64),
    createdAt: "2026-08-21T20:00:00.000Z",
    kind: "session.event.append",
    payload: {
      eventId: ids.event,
      sessionId: ids.session,
      sessionRevision: 3,
      sourceClientInstanceId: ids.client,
      agentRunId: null,
      occurredAt: "2026-08-21T20:00:00.000Z",
      artifactLinks: [],
      eventType: "reasoning_summary",
      summaryKind: "analysis",
      summaryText: "Mismatched envelope",
    },
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.issues.length, 2);
  }
});
