import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { count, eq } from "drizzle-orm";
import {
  SyncChangeEnvelopeSchema,
  type JsonValue,
} from "@curve-ai/radius-sync-protocol";

import { canonicalJson, sha256Hex } from "./canonical-json.js";
import { migrateRadiusDatabase, openRadiusDatabase } from "./database.js";
import {
  agentRunPresentations,
  agentRuns,
  artifacts,
  clientInstances,
  eventRuns,
  fileChanges,
  localChanges,
  messageParts,
  messages,
  projectFiles,
  projectFileVersions,
  projectRoots,
  projects,
  sessionPins,
  sessions,
  syncDeliveries,
} from "./schema.js";
import {
  appendSessionEvent,
  createProject,
  createSession,
  listAgentRunFileOutcomes,
  listAllProjectSessions,
  listProjectSessions,
  listProjects,
  listRecentSessions,
  listSessionTranscript,
  setSessionArchived,
  setSessionPinned,
  updateProjectName,
} from "./store.js";
import { applyRemoteChange, configureSyncConnection } from "./store.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

const clientId = "19353755-3c5e-4529-b58d-c74dacf7b68d";

async function removeTemporaryDirectory(directory: string): Promise<void> {
  try {
    await rm(directory, { force: true, recursive: true });
  } catch (error) {
    if (
      process.platform === "win32" &&
      (error as NodeJS.ErrnoException).code === "EBUSY"
    ) {
      return;
    }
    throw error;
  }
}

async function withDatabase(
  callback: Awaited<ReturnType<typeof openRadiusDatabase>> extends infer T
    ? (database: T) => Promise<void>
    : never,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "radius-store-"));
  const database = await openRadiusDatabase({
    path: path.join(directory, "radius.db"),
  });
  try {
    await migrateRadiusDatabase(database, migrationsFolder);
    const now = Date.now();
    await database.db.insert(clientInstances).values({
      id: clientId,
      displayName: "Test Mac",
      platform: "darwin",
      publicKeyJwk: JSON.stringify({ kty: "OKP", crv: "Ed25519", x: "test" }),
      isLocal: true,
      createdAtMs: now,
      updatedAtMs: now,
    });
    await callback(database);
  } finally {
    database.close();
    await removeTemporaryDirectory(directory);
  }
}

test("writes a typed message, artifact, and sync change atomically", async () => {
  await withDatabase(async (database) => {
    const session = await createSession(database, {
      originClientInstanceId: clientId,
      title: "Typed storage",
      now: Date.parse("2026-08-21T20:00:00.000Z"),
    });
    const eventId = "97c9a24c-5f06-4af0-8c7e-8fc31b2e8295";
    const artifactId = "c440b00f-e788-4616-8e60-b77d7bab5e1e";

    await appendSessionEvent(
      database,
      {
        eventId,
        sessionId: session.id,
        sessionRevision: 2,
        sourceClientInstanceId: clientId,
        agentRunId: null,
        occurredAt: "2026-08-21T20:01:00.000Z",
        eventType: "message",
        role: "assistant",
        messageKind: "final",
        status: "completed",
        model: "example-model",
        providerMessageId: null,
        finishReason: "stop",
        artifactLinks: [
          {
            relationship: "output",
            artifact: {
              id: artifactId,
              sessionId: session.id,
              name: "report.pdf",
              artifactType: "document",
              storageKind: "file",
              mimeType: "application/pdf",
              contentSha256: "a".repeat(64),
              byteSize: 128,
              supersedesArtifactId: null,
              createdAt: "2026-08-21T20:01:00.000Z",
              deletedAt: null,
            },
          },
        ],
        parts: [
          {
            id: "bba137bb-ab7e-4661-8569-34a5c51a636d",
            position: 0,
            partType: "text",
            text: "Here is the report.",
          },
          {
            id: "2e3f0363-bbbc-44f6-ac2b-4a4e7b16d54e",
            position: 1,
            partType: "artifact_reference",
            artifactId,
          },
        ],
      },
      { fileLocations: { [artifactId]: "sha256/aa/report.pdf" } },
    );

    const [storedSession] = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));
    assert.equal(storedSession?.revision, 2);
    assert.equal((await database.db.select().from(messages)).length, 1);
    assert.equal((await database.db.select().from(messageParts)).length, 2);
    assert.equal((await database.db.select().from(artifacts)).length, 1);
    const [changeCount] = await database.db
      .select({ value: count() })
      .from(localChanges);
    assert.equal(changeCount?.value, 2);
    assert.deepEqual(await listSessionTranscript(database, session.id), [
      {
        eventId,
        sessionRevision: 2,
        occurredAt: "2026-08-21T20:01:00.000Z",
        agentRunId: null,
        eventType: "message",
        role: "assistant",
        messageKind: "final",
        status: "completed",
        text: "Here is the report.",
      },
    ]);
    assert.equal(
      (await listRecentSessions(database, clientId))[0]?.lastAssistantMessageAt,
      "2026-08-21T20:01:00.000Z",
    );
  });
});

test("projects canonical plans and step updates into the session transcript", async () => {
  await withDatabase(async (database) => {
    const session = await createSession(database, {
      originClientInstanceId: clientId,
      title: "Plan projection",
      now: Date.parse("2026-08-24T18:00:00.000Z"),
    });
    const agentRunId = "bcd95039-4a82-4f29-9087-2f459f611d28";
    const planId = "0c10b7c7-c04b-4f77-8f98-cae6001e4033";
    const stepId = "645cb784-c83a-4b31-b91d-8c3f0d4ea9da";

    await appendSessionEvent(database, {
      eventId: "31084b72-5538-4d69-84ed-a3fdf11aa909",
      sessionId: session.id,
      sessionRevision: 2,
      sourceClientInstanceId: clientId,
      agentRunId,
      occurredAt: "2026-08-24T18:01:00.000Z",
      artifactLinks: [],
      eventType: "agent_run",
      providerKey: "fx",
      providerRunId: null,
      triggeringMessageEventId: null,
    });
    await appendSessionEvent(database, {
      eventId: "5e6faacb-1ef3-42ca-a7ab-64e455be5a66",
      sessionId: session.id,
      sessionRevision: 3,
      sourceClientInstanceId: clientId,
      agentRunId,
      occurredAt: "2026-08-24T18:02:00.000Z",
      artifactLinks: [],
      eventType: "task_plan",
      planId,
      title: "Plan",
      supersedesPlanId: null,
      steps: [{ id: stepId, position: 0, title: "Render plan progress" }],
    });
    await appendSessionEvent(database, {
      eventId: "1fb07302-09d9-43b5-810a-f0e124104c59",
      sessionId: session.id,
      sessionRevision: 4,
      sourceClientInstanceId: clientId,
      agentRunId,
      occurredAt: "2026-08-24T18:03:00.000Z",
      artifactLinks: [],
      eventType: "task_step_update",
      taskStepId: stepId,
      state: "in_progress",
      detail: "Matching the supplied reference",
    });

    assert.deepEqual(await listSessionTranscript(database, session.id), [
      {
        eventId: "31084b72-5538-4d69-84ed-a3fdf11aa909",
        sessionRevision: 2,
        occurredAt: "2026-08-24T18:01:00.000Z",
        agentRunId,
        eventType: "agent_run",
        providerKey: "fx",
      },
      {
        eventId: "5e6faacb-1ef3-42ca-a7ab-64e455be5a66",
        sessionRevision: 3,
        occurredAt: "2026-08-24T18:02:00.000Z",
        agentRunId,
        eventType: "task_plan",
        planId,
        title: "Plan",
        supersedesPlanId: null,
        steps: [{ id: stepId, position: 0, title: "Render plan progress" }],
      },
      {
        eventId: "1fb07302-09d9-43b5-810a-f0e124104c59",
        sessionRevision: 4,
        occurredAt: "2026-08-24T18:03:00.000Z",
        agentRunId,
        eventType: "task_step_update",
        taskStepId: stepId,
        state: "in_progress",
        detail: "Matching the supplied reference",
      },
    ]);
  });
});

test("stores provider presentation separately from durable project file outcomes", async () => {
  await withDatabase(async (database) => {
    const project = await createProject(database, {
      originClientInstanceId: clientId,
      name: "Customer work",
      rootPath: "/workspace/customer-work",
      now: Date.parse("2026-08-22T14:00:00.000Z"),
    });
    const session = await createSession(database, {
      originClientInstanceId: clientId,
      projectId: project.id,
      title: "Prepare the customer brief",
      now: Date.parse("2026-08-22T14:01:00.000Z"),
    });
    const agentRunId = "445d951a-ff55-4eca-a032-a8a58d818d09";

    await appendSessionEvent(database, {
      eventId: "6d3f7df5-1dc4-4564-8f04-124df85a69b1",
      sessionId: session.id,
      sessionRevision: 2,
      sourceClientInstanceId: clientId,
      agentRunId,
      occurredAt: "2026-08-22T14:02:00.000Z",
      artifactLinks: [],
      eventType: "agent_run",
      providerKey: "example-provider",
      providerRunId: "provider-run-1",
      triggeringMessageEventId: null,
    });

    await appendSessionEvent(database, {
      eventId: "7d3f7df5-1dc4-4564-8f04-124df85a69b1",
      sessionId: session.id,
      sessionRevision: 3,
      sourceClientInstanceId: clientId,
      agentRunId,
      occurredAt: "2026-08-22T14:02:15.000Z",
      artifactLinks: [],
      eventType: "message",
      role: "assistant",
      messageKind: "progress",
      status: "completed",
      model: "example-model",
      providerMessageId: null,
      finishReason: null,
      parts: [
        {
          id: "8d3f7df5-1dc4-4564-8f04-124df85a69b1",
          position: 0,
          partType: "text",
          text: "Creating the customer brief.",
        },
      ],
    });

    const projectFileId = "9d3f7df5-1dc4-4564-8f04-124df85a69b1";
    const versionId = "ad3f7df5-1dc4-4564-8f04-124df85a69b1";
    await appendSessionEvent(
      database,
      {
        eventId: "bd3f7df5-1dc4-4564-8f04-124df85a69b1",
        sessionId: session.id,
        sessionRevision: 4,
        sourceClientInstanceId: clientId,
        agentRunId,
        occurredAt: "2026-08-22T14:03:00.000Z",
        artifactLinks: [],
        eventType: "file_change",
        projectId: project.id,
        projectFileId,
        projectFileCreatedAt: "2026-08-22T14:03:00.000Z",
        toolCallEventId: null,
        operation: "create",
        beforeVersion: null,
        afterVersion: {
          id: versionId,
          relativePath: "deliverables/customer-brief.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          contentSha256: "b".repeat(64),
          byteSize: 2048,
          capturedAt: "2026-08-22T14:03:00.000Z",
        },
        textDiff: null,
      },
      {
        fileVersionLocations: {
          [versionId]: "sha256/bb/customer-brief.docx",
        },
      },
    );

    await appendSessionEvent(database, {
      eventId: "cd3f7df5-1dc4-4564-8f04-124df85a69b1",
      sessionId: session.id,
      sessionRevision: 5,
      sourceClientInstanceId: clientId,
      agentRunId,
      occurredAt: "2026-08-22T14:04:00.000Z",
      artifactLinks: [],
      eventType: "agent_run_presentation",
      mode: "collapsible",
      initialState: "collapsed",
      summaryMessageEventId: null,
      label: "Worked",
    });

    assert.equal((await database.db.select().from(agentRuns)).length, 1);
    assert.equal((await database.db.select().from(eventRuns)).length, 4);
    assert.equal(
      (await database.db.select().from(agentRunPresentations))[0]?.mode,
      "collapsible",
    );
    assert.equal((await database.db.select().from(projectFiles)).length, 1);
    assert.equal(
      (await database.db.select().from(projectFileVersions))[0]?.relativePath,
      "deliverables/customer-brief.docx",
    );
    assert.equal(
      (await database.db.select().from(fileChanges))[0]?.operation,
      "create",
    );
    assert.deepEqual(
      (await listSessionTranscript(database, session.id)).map(
        (event) => event.eventType,
      ),
      ["agent_run", "message", "agent_run_presentation"],
    );
    assert.deepEqual(await listAgentRunFileOutcomes(database, agentRunId), [
      {
        eventId: "bd3f7df5-1dc4-4564-8f04-124df85a69b1",
        operation: "create",
        occurredAtMs: Date.parse("2026-08-22T14:03:00.000Z"),
        projectFileId,
        beforeVersion: null,
        afterVersion: {
          id: versionId,
          relativePath: "deliverables/customer-brief.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          contentSha256: "b".repeat(64),
          byteSize: 2048,
          availability: "local",
          capturedAtMs: Date.parse("2026-08-22T14:03:00.000Z"),
        },
        textAdditions: null,
        textDeletions: null,
      },
    ]);
  });
});

test("creates one-root projects and groups sessions without syncing the path", async () => {
  await withDatabase(async (database) => {
    const project = await createProject(database, {
      originClientInstanceId: clientId,
      name: "agentic-workspace",
      rootPath: "/workspace/agentic-workspace",
      now: Date.parse("2026-08-22T12:00:00.000Z"),
    });
    const session = await createSession(database, {
      originClientInstanceId: clientId,
      projectId: project.id,
      title: "Add projects",
      now: Date.parse("2026-08-22T12:01:00.000Z"),
    });

    const [storedRoot] = await database.db.select().from(projectRoots);
    assert.equal(storedRoot?.rootPath, "/workspace/agentic-workspace");
    const changes = await database.db
      .select({
        kind: localChanges.kind,
        payloadJson: localChanges.payloadJson,
      })
      .from(localChanges);
    assert.deepEqual(
      changes.map((change) => change.kind),
      ["project.upsert", "session.upsert"],
    );
    assert.equal(
      changes.some((change) =>
        change.payloadJson.includes("/workspace/agentic-workspace"),
      ),
      false,
    );

    const summaries = await listProjects(database, clientId);
    assert.equal(summaries[0]?.rootPath, "/workspace/agentic-workspace");
    const projectSessions = await listProjectSessions(
      database,
      project.id,
      clientId,
    );
    assert.equal(projectSessions[0]?.id, session.id);
    assert.equal(projectSessions[0]?.projectId, project.id);
    assert.equal(projectSessions[0]?.pinnedAt, null);
  });
});

test("renames a project with a typed revision and keeps its root local", async () => {
  await withDatabase(async (database) => {
    const project = await createProject(database, {
      originClientInstanceId: clientId,
      name: "Before",
      rootPath: "/workspace/rename-test",
      now: Date.parse("2026-08-22T12:00:00.000Z"),
    });

    const renamed = await updateProjectName(database, {
      projectId: project.id,
      originClientInstanceId: clientId,
      name: "After",
      now: Date.parse("2026-08-22T12:01:00.000Z"),
    });

    assert.equal(renamed.name, "After");
    assert.equal(renamed.revision, 2);
    const [stored] = await database.db
      .select()
      .from(projects)
      .where(eq(projects.id, project.id));
    assert.equal(stored?.name, "After");
    assert.equal(stored?.revision, 2);
    const changes = await database.db.select().from(localChanges);
    assert.equal(changes.length, 2);
    assert.equal(
      changes.some((change) => change.payloadJson.includes("rename-test")),
      false,
    );
  });
});

test("lists only non-project sessions in recents with local pin state", async () => {
  await withDatabase(async (database) => {
    const recent = await createSession(database, {
      originClientInstanceId: clientId,
      title: "Standalone chat",
      now: Date.parse("2026-08-22T12:00:00.000Z"),
    });
    const project = await createProject(database, {
      originClientInstanceId: clientId,
      name: "Project",
      rootPath: "/workspace/recents-test",
      now: Date.parse("2026-08-22T12:01:00.000Z"),
    });
    await createSession(database, {
      originClientInstanceId: clientId,
      projectId: project.id,
      title: "Project chat",
      now: Date.parse("2026-08-22T12:02:00.000Z"),
    });
    await setSessionPinned(database, {
      clientInstanceId: clientId,
      sessionId: recent.id,
      pinned: true,
      now: Date.parse("2026-08-22T12:03:00.000Z"),
    });

    const recents = await listRecentSessions(database, clientId);
    assert.deepEqual(
      recents.map((session) => session.title),
      ["Standalone chat"],
    );
    assert.equal(recents[0]?.pinnedAt, "2026-08-22T12:03:00.000Z");
    assert.deepEqual(
      (await listAllProjectSessions(database, clientId)).map(
        (session) => session.title,
      ),
      ["Project chat"],
    );
  });
});

test("pins sessions locally without creating a sync change", async () => {
  await withDatabase(async (database) => {
    const project = await createProject(database, {
      originClientInstanceId: clientId,
      name: "Pinned work",
      rootPath: "/workspace/pinned-work",
      now: Date.parse("2026-08-22T16:00:00.000Z"),
    });
    const session = await createSession(database, {
      originClientInstanceId: clientId,
      projectId: project.id,
      title: "Keep this close",
      now: Date.parse("2026-08-22T16:01:00.000Z"),
    });
    const pinnedAt = "2026-08-22T16:02:00.000Z";

    assert.equal(
      await setSessionPinned(database, {
        clientInstanceId: clientId,
        sessionId: session.id,
        pinned: true,
        now: Date.parse(pinnedAt),
      }),
      pinnedAt,
    );
    let projectSessions = await listProjectSessions(
      database,
      project.id,
      clientId,
    );
    assert.equal(projectSessions[0]?.pinnedAt, pinnedAt);
    assert.equal((await database.db.select().from(localChanges)).length, 2);

    assert.equal(
      await setSessionPinned(database, {
        clientInstanceId: clientId,
        sessionId: session.id,
        pinned: false,
      }),
      null,
    );
    projectSessions = await listProjectSessions(database, project.id, clientId);
    assert.equal(projectSessions[0]?.pinnedAt, null);
    assert.equal((await database.db.select().from(localChanges)).length, 2);

    await database.db
      .update(sessions)
      .set({ archivedAtMs: Date.parse("2026-08-22T16:03:00.000Z") })
      .where(eq(sessions.id, session.id));
    await assert.rejects(
      setSessionPinned(database, {
        clientInstanceId: clientId,
        sessionId: session.id,
        pinned: true,
      }),
      /active session/,
    );
  });
});

test("archives a local-origin session and records the revision for sync", async () => {
  await withDatabase(async (database) => {
    const session = await createSession(database, {
      originClientInstanceId: clientId,
      title: "Archive this",
      now: Date.parse("2026-08-22T17:00:00.000Z"),
    });
    await setSessionPinned(database, {
      clientInstanceId: clientId,
      sessionId: session.id,
      pinned: true,
      now: Date.parse("2026-08-22T17:01:00.000Z"),
    });

    const archived = await setSessionArchived(database, {
      originClientInstanceId: clientId,
      sessionId: session.id,
      now: Date.parse("2026-08-22T17:02:00.000Z"),
    });

    assert.equal(archived.revision, 2);
    assert.equal(archived.archivedAt, "2026-08-22T17:02:00.000Z");
    assert.deepEqual(await listRecentSessions(database, clientId), []);
    assert.equal((await database.db.select().from(sessionPins)).length, 0);
    const changes = await database.db.select().from(localChanges);
    assert.equal(changes.length, 2);
    assert.equal(changes[1]?.kind, "session.upsert");
    assert.match(
      changes[1]?.payloadJson ?? "",
      /\"archivedAt\":\"2026-08-22T17:02:00.000Z\"/,
    );
  });
});

test("rejects duplicate project roots without leaving partial records", async () => {
  await withDatabase(async (database) => {
    await createProject(database, {
      originClientInstanceId: clientId,
      name: "First",
      rootPath: "/workspace/shared",
    });
    await assert.rejects(
      createProject(database, {
        originClientInstanceId: clientId,
        name: "Duplicate",
        rootPath: "/workspace/shared",
      }),
    );
    assert.equal((await database.db.select().from(projects)).length, 1);
    assert.equal((await database.db.select().from(localChanges)).length, 1);
  });
});

test("rejects a non-origin writer without leaving partial rows", async () => {
  await withDatabase(async (database) => {
    const session = await createSession(database, {
      originClientInstanceId: clientId,
      title: "Origin only",
    });

    await assert.rejects(
      appendSessionEvent(database, {
        eventId: "97c9a24c-5f06-4af0-8c7e-8fc31b2e8295",
        sessionId: session.id,
        sessionRevision: 2,
        sourceClientInstanceId: "5fa9aa30-7a20-4bba-8921-8bff4b0a159d",
        agentRunId: null,
        occurredAt: "2026-08-21T20:01:00.000Z",
        eventType: "reasoning_summary",
        summaryKind: "analysis",
        summaryText: "This must not persist.",
        artifactLinks: [],
      }),
      /origin client instance/,
    );

    const [storedSession] = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));
    assert.equal(storedSession?.revision, 1);
    const [changeCount] = await database.db
      .select({ value: count() })
      .from(localChanges);
    assert.equal(changeCount?.value, 1);
  });
});

test("enabling sync backfills existing local changes in one database operation", async () => {
  await withDatabase(async (database) => {
    await createSession(database, {
      originClientInstanceId: clientId,
      title: "Created before sync",
    });
    assert.equal((await database.db.select().from(syncDeliveries)).length, 0);

    await configureSyncConnection(database, {
      id: "4b3a2c8f-d0f9-4f4a-93b7-89179c68d292",
      providerKey: "test",
      endpointUrl: "https://sync.example.test",
      credentialRef: null,
      remoteSubject: null,
      accountLabel: null,
      enabled: true,
    });

    assert.equal((await database.db.select().from(syncDeliveries)).length, 1);
  });
});

test("creates a non-local client identity for a pulled read-only session", async () => {
  await withDatabase(async (database) => {
    const connectionId = "4b3a2c8f-d0f9-4f4a-93b7-89179c68d292";
    const remoteClientId = "445d951a-ff55-4eca-a032-a8a58d818d09";
    const remoteSessionId = "114464fb-c83e-4f9f-91f7-7e2d73bb7c44";
    await configureSyncConnection(database, {
      id: connectionId,
      providerKey: "test",
      endpointUrl: "https://sync.example.test",
      credentialRef: null,
      remoteSubject: null,
      accountLabel: null,
      enabled: false,
    });
    const payload = {
      id: remoteSessionId,
      originClientInstanceId: remoteClientId,
      projectId: null,
      title: "Remote session",
      status: "active" as const,
      revision: 1,
      createdAt: "2026-08-21T20:00:00.000Z",
      updatedAt: "2026-08-21T20:00:00.000Z",
      archivedAt: null,
      deletedAt: null,
    };
    const payloadJson = canonicalJson(payload as unknown as JsonValue);
    const change = SyncChangeEnvelopeSchema.parse({
      protocolVersion: 1,
      changeId: "f421a8b3-bc2e-46a8-98fd-c86037a5f029",
      originClientInstanceId: remoteClientId,
      sessionId: remoteSessionId,
      sessionRevision: 1,
      payloadSchemaVersion: 1,
      payloadSha256: sha256Hex(payloadJson),
      createdAt: payload.createdAt,
      kind: "session.upsert",
      payload,
    });

    assert.equal(
      await applyRemoteChange(database, connectionId, change),
      "applied",
    );
    const clients = await database.db.select().from(clientInstances);
    assert.equal(clients.length, 2);
    assert.equal(clients.filter((client) => client.isLocal).length, 1);
    assert.equal(
      clients.find((client) => client.id === remoteClientId)?.isLocal,
      false,
    );
    const [changeCount] = await database.db
      .select({ value: count() })
      .from(localChanges);
    assert.equal(changeCount?.value, 0);

    const foreignClientId = "d8946a8d-1a93-48d8-9f83-311e4b99f576";
    const foreignPayload = {
      ...payload,
      originClientInstanceId: foreignClientId,
      revision: 2,
      updatedAt: "2026-08-21T20:01:00.000Z",
    };
    const foreignPayloadJson = canonicalJson(
      foreignPayload as unknown as JsonValue,
    );
    const foreignChange = SyncChangeEnvelopeSchema.parse({
      protocolVersion: 1,
      changeId: "c99c2793-8594-4ccb-bef0-440ec75f0a35",
      originClientInstanceId: foreignClientId,
      sessionId: remoteSessionId,
      sessionRevision: 2,
      payloadSchemaVersion: 1,
      payloadSha256: sha256Hex(foreignPayloadJson),
      createdAt: foreignPayload.updatedAt,
      kind: "session.upsert",
      payload: foreignPayload,
    });
    await assert.rejects(
      applyRemoteChange(database, connectionId, foreignChange),
      /origin client instance changed/,
    );

    const foreignEvent = {
      eventId: "a46c29a8-2b96-4ef2-a79b-a7f18fd7b564",
      sessionId: remoteSessionId,
      sessionRevision: 2,
      sourceClientInstanceId: foreignClientId,
      agentRunId: null,
      occurredAt: "2026-08-21T20:01:00.000Z",
      eventType: "reasoning_summary" as const,
      summaryKind: "analysis" as const,
      summaryText: "This foreign origin must not append.",
      artifactLinks: [],
    };
    const foreignEventJson = canonicalJson(
      foreignEvent as unknown as JsonValue,
    );
    const foreignEventChange = SyncChangeEnvelopeSchema.parse({
      protocolVersion: 1,
      changeId: "523693bc-8874-42d9-9979-49979a0f20b9",
      originClientInstanceId: foreignClientId,
      sessionId: remoteSessionId,
      sessionRevision: 2,
      payloadSchemaVersion: 1,
      payloadSha256: sha256Hex(foreignEventJson),
      createdAt: foreignEvent.occurredAt,
      kind: "session.event.append",
      payload: foreignEvent,
    });
    await assert.rejects(
      applyRemoteChange(database, connectionId, foreignEventChange),
      /origin client instance changed/,
    );
    const [storedRemoteSession] = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, remoteSessionId));
    assert.equal(storedRemoteSession?.revision, 1);
  });
});

test("rejects remote project revisions from a different origin", async () => {
  await withDatabase(async (database) => {
    const connectionId = "73b6620a-a2e0-4d48-a509-f9fd30d51d67";
    const projectId = "86d55c97-e452-48f1-953d-31c9a4be2623";
    const originalClientId = "a4f64ad8-1791-4302-9f70-683df8cf13ef";
    const foreignClientId = "178670d3-a17a-420c-934c-7e82a23a5ff5";
    await configureSyncConnection(database, {
      id: connectionId,
      providerKey: "test",
      endpointUrl: "https://sync.example.test",
      credentialRef: null,
      remoteSubject: null,
      accountLabel: null,
      enabled: false,
    });

    const remoteProjectChange = (
      originClientInstanceId: string,
      revision: number,
      changeId: string,
    ) => {
      const updatedAt = `2026-08-21T20:0${revision - 1}:00.000Z`;
      const payload = {
        id: projectId,
        originClientInstanceId,
        name: `Remote project ${revision}`,
        revision,
        createdAt: "2026-08-21T20:00:00.000Z",
        updatedAt,
        archivedAt: null,
        deletedAt: null,
      };
      const payloadJson = canonicalJson(payload as unknown as JsonValue);
      return SyncChangeEnvelopeSchema.parse({
        protocolVersion: 1,
        changeId,
        originClientInstanceId,
        projectId,
        projectRevision: revision,
        payloadSchemaVersion: 1,
        payloadSha256: sha256Hex(payloadJson),
        createdAt: updatedAt,
        kind: "project.upsert",
        payload,
      });
    };

    await applyRemoteChange(
      database,
      connectionId,
      remoteProjectChange(
        originalClientId,
        1,
        "581dfe78-ea03-41dd-b4c1-a77b331e440e",
      ),
    );
    await assert.rejects(
      applyRemoteChange(
        database,
        connectionId,
        remoteProjectChange(
          foreignClientId,
          2,
          "fdced89e-91fc-4a10-be04-9cbdc7603884",
        ),
      ),
      /origin client instance changed/,
    );
    const [storedProject] = await database.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    assert.equal(storedProject?.originClientInstanceId, originalClientId);
    assert.equal(storedProject?.revision, 1);
  });
});
