/**
 * End-to-end proof that conversation sync works on the platform database.
 *
 * Needs a real PostgreSQL: the interesting behaviour is in transactions,
 * revision conflicts, cross-schema foreign keys and the cursor, none of which
 * a stubbed database would exercise. Point DATABASE_URL at a throwaway
 * database and run it.
 *
 *   DATABASE_URL=postgres://... RADIUS_SYNC_CURSOR_SECRET=x bun run verify:sync
 */
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";

import {
  createPlatformDatabase,
  migratePlatformDatabase,
  platformSchema,
  provisionPlatformOrganization,
} from "@curve-ai/platform-database";
import {
  SyncChangeEnvelopeSchema,
  payloadSha256,
  type JsonValue,
  type SyncChangeEnvelope,
} from "@curve-ai/radius-sync-protocol";

import { createFileSystemArtifactStore } from "../src/sync/artifact-store.js";
import { verifyDeviceRequest } from "../src/sync/device-auth.js";
import { withSyncOwner } from "../src/sync/owner.js";
import {
  applySyncChange,
  pullSyncChanges,
  type SyncOwner,
} from "../src/sync/service.js";

const {
  syncAgentRunPresentations,
  syncDevices,
  syncFileArtifacts,
  syncFileChanges,
  syncProjects,
  syncReasoningSummaries,
  syncSessions,
} = platformSchema;

const createdAt = new Date().toISOString();

type ChangeWithoutHash = SyncChangeEnvelope extends infer Change
  ? Change extends unknown
    ? Omit<Change, "payloadSha256">
    : never
  : never;

function change(input: ChangeWithoutHash): SyncChangeEnvelope {
  return SyncChangeEnvelopeSchema.parse({
    ...input,
    payloadSha256: payloadSha256(input.payload as unknown as JsonValue),
  });
}

interface Tenant {
  owner: SyncOwner;
  deviceId: string;
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
}

async function provisionTenant(
  pool: Parameters<typeof provisionPlatformOrganization>[0],
  database: ReturnType<typeof createPlatformDatabase>["db"],
  slug: string,
): Promise<Tenant> {
  const organizationId = randomUUID();
  const accountId = randomUUID();
  const provisioned = await provisionPlatformOrganization(pool, {
    apiVersion: 1,
    organization: { id: organizationId, slug, displayName: `Org ${slug}` },
    owner: {
      accountId,
      displayName: "Sync verification",
      identity: {
        issuer: "https://issuer.example.test",
        subject: `${slug}-subject`,
        email: `${slug}@example.test`,
        emailVerified: true,
      },
    },
  });
  const owner: SyncOwner = {
    organizationId: provisioned.organizationId,
    membershipId: provisioned.membershipId,
  };

  const deviceId = randomUUID();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  await withSyncOwner(database, owner, (transaction) =>
    transaction.insert(syncDevices).values({
    id: deviceId,
    ...owner,
    clientInstallationId: null,
    displayName: "Verification device",
    platform: "darwin",
    publicKeyJwk: publicKey.export({ format: "jwk" }) as JsonWebKey,
    appVersion: "0.0.1",
    createdAt: new Date(),
    lastSeenAt: new Date(),
    revokedAt: null,
    }),
  );
  return { owner, deviceId, privateKey };
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required");
  process.env.RADIUS_SYNC_CURSOR_SECRET ||= "sync-verification-cursor-secret";

  const { pool, db: database } = createPlatformDatabase({
    connectionString,
    applicationName: "radius-sync-verification",
  });
  const artifactDirectory = await mkdtemp(
    path.join(tmpdir(), "radius-sync-verify-artifacts-"),
  );
  try {
    await migratePlatformDatabase(pool);

    const acme = await provisionTenant(
      pool,
      database,
      `verify-a-${randomUUID().slice(0, 8)}`,
    );
    const other = await provisionTenant(
      pool,
      database,
      `verify-b-${randomUUID().slice(0, 8)}`,
    );
    const { owner, deviceId, privateKey } = acme;

    // --- device signature ------------------------------------------------
    const signedBody = "{}";
    const signedTimestamp = new Date().toISOString();
    const signedUrl = new URL(
      "http://localhost/api/platform/v1/sync/push",
    );
    const signedHash = createHash("sha256").update(signedBody).digest("hex");
    const signedInput = `POST\n${signedUrl.pathname}\n${signedTimestamp}\n${signedHash}`;
    const signature = sign(null, Buffer.from(signedInput), privateKey).toString(
      "base64url",
    );
    const signedRequest = new Request(signedUrl, {
      method: "POST",
      headers: {
        "x-radius-client-instance-id": deviceId,
        "x-radius-timestamp": signedTimestamp,
        "x-radius-signature": signature,
      },
      body: signedBody,
    });
    assert.equal(
      await withSyncOwner(database, owner, (transaction) =>
        verifyDeviceRequest(
          transaction,
          signedRequest,
          owner.membershipId,
          signedBody,
        ),
        ),
      deviceId,
    );

    // A device enrolled to one membership must not authenticate another's
    // requests, even with a valid signature.
    await assert.rejects(
      withSyncOwner(database, other.owner, (transaction) =>
        verifyDeviceRequest(
          transaction,
          signedRequest,
          other.owner.membershipId,
          signedBody,
        ),
        ),
      /DEVICE_NOT_REGISTERED/,
    );

    // --- projections -----------------------------------------------------
    const projectId = randomUUID();
    const sessionId = randomUUID();

    const projectChange = change({
      protocolVersion: 1,
      changeId: randomUUID(),
      originClientInstanceId: deviceId,
      projectId,
      projectRevision: 1,
      payloadSchemaVersion: 1,
      createdAt,
      kind: "project.upsert",
      payload: {
        id: projectId,
        originClientInstanceId: deviceId,
        name: "Sync verification",
        revision: 1,
        createdAt,
        updatedAt: createdAt,
        archivedAt: null,
        deletedAt: null,
      },
    });
    assert.equal(
      (await applySyncChange(database, owner, deviceId, projectChange)).status,
      "accepted",
    );

    const sessionChange = change({
      protocolVersion: 1,
      changeId: randomUUID(),
      originClientInstanceId: deviceId,
      sessionId,
      sessionRevision: 1,
      payloadSchemaVersion: 1,
      createdAt,
      kind: "session.upsert",
      payload: {
        id: sessionId,
        originClientInstanceId: deviceId,
        projectId,
        title: "Sync verification",
        status: "active",
        revision: 1,
        createdAt,
        updatedAt: createdAt,
        archivedAt: null,
        deletedAt: null,
      },
    });
    assert.equal(
      (await applySyncChange(database, owner, deviceId, sessionChange)).status,
      "accepted",
    );
    assert.equal(
      (await applySyncChange(database, owner, deviceId, sessionChange)).status,
      "duplicate",
    );

    const eventChange = change({
      protocolVersion: 1,
      changeId: randomUUID(),
      originClientInstanceId: deviceId,
      sessionId,
      sessionRevision: 2,
      payloadSchemaVersion: 1,
      createdAt,
      kind: "session.event.append",
      payload: {
        eventId: randomUUID(),
        sessionId,
        sessionRevision: 2,
        sourceClientInstanceId: deviceId,
        agentRunId: null,
        occurredAt: createdAt,
        artifactLinks: [],
        eventType: "reasoning_summary",
        summaryKind: "analysis",
        summaryText: "Verifying typed platform projection.",
      },
    });
    assert.equal(
      (await applySyncChange(database, owner, deviceId, eventChange)).status,
      "accepted",
    );

    const artifactBytes = new TextEncoder().encode("verified artifact bytes");
    const artifactHash = createHash("sha256")
      .update(artifactBytes)
      .digest("hex");
    const artifactId = randomUUID();
    const artifactChange = change({
      protocolVersion: 1,
      changeId: randomUUID(),
      originClientInstanceId: deviceId,
      sessionId,
      sessionRevision: 3,
      payloadSchemaVersion: 1,
      createdAt,
      kind: "session.event.append",
      payload: {
        eventId: randomUUID(),
        sessionId,
        sessionRevision: 3,
        sourceClientInstanceId: deviceId,
        agentRunId: null,
        occurredAt: createdAt,
        artifactLinks: [
          {
            relationship: "output",
            artifact: {
              id: artifactId,
              sessionId,
              name: "verification.txt",
              artifactType: "document",
              storageKind: "file",
              mimeType: "text/plain",
              contentSha256: artifactHash,
              byteSize: artifactBytes.byteLength,
              supersedesArtifactId: null,
              createdAt,
              deletedAt: null,
            },
          },
        ],
        eventType: "message",
        role: "assistant",
        messageKind: "final",
        status: "completed",
        model: null,
        providerMessageId: null,
        finishReason: null,
        parts: [
          {
            id: randomUUID(),
            position: 0,
            partType: "artifact_reference",
            artifactId,
          },
        ],
      },
    });
    assert.equal(
      (await applySyncChange(database, owner, deviceId, artifactChange)).status,
      "accepted",
    );
    const artifactStore = createFileSystemArtifactStore(artifactDirectory);
    assert.equal(
      await artifactStore.put(artifactHash, artifactBytes),
      `sha256:${artifactHash}`,
    );
    assert.equal(await artifactStore.has(artifactHash), true);

    const agentRunId = randomUUID();
    assert.equal(
      (
        await applySyncChange(
          database,
          owner,
          deviceId,
          change({
            protocolVersion: 1,
            changeId: randomUUID(),
            originClientInstanceId: deviceId,
            sessionId,
            sessionRevision: 4,
            payloadSchemaVersion: 1,
            createdAt,
            kind: "session.event.append",
            payload: {
              eventId: randomUUID(),
              sessionId,
              sessionRevision: 4,
              sourceClientInstanceId: deviceId,
              agentRunId,
              occurredAt: createdAt,
              artifactLinks: [],
              eventType: "agent_run",
              providerKey: "verification-provider",
              providerRunId: randomUUID(),
              triggeringMessageEventId: null,
            },
          }),
        )
      ).status,
      "accepted",
    );

    const projectFileId = randomUUID();
    assert.equal(
      (
        await applySyncChange(
          database,
          owner,
          deviceId,
          change({
            protocolVersion: 1,
            changeId: randomUUID(),
            originClientInstanceId: deviceId,
            sessionId,
            sessionRevision: 5,
            payloadSchemaVersion: 1,
            createdAt,
            kind: "session.event.append",
            payload: {
              eventId: randomUUID(),
              sessionId,
              sessionRevision: 5,
              sourceClientInstanceId: deviceId,
              agentRunId,
              occurredAt: createdAt,
              artifactLinks: [],
              eventType: "file_change",
              projectId,
              projectFileId,
              projectFileCreatedAt: createdAt,
              toolCallEventId: null,
              operation: "create",
              beforeVersion: null,
              afterVersion: {
                id: randomUUID(),
                relativePath: "deliverables/customer-brief.docx",
                mimeType:
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                contentSha256: "b".repeat(64),
                byteSize: 2048,
                capturedAt: createdAt,
              },
              textDiff: null,
            },
          }),
        )
      ).status,
      "accepted",
    );

    assert.equal(
      (
        await applySyncChange(
          database,
          owner,
          deviceId,
          change({
            protocolVersion: 1,
            changeId: randomUUID(),
            originClientInstanceId: deviceId,
            sessionId,
            sessionRevision: 6,
            payloadSchemaVersion: 1,
            createdAt,
            kind: "session.event.append",
            payload: {
              eventId: randomUUID(),
              sessionId,
              sessionRevision: 6,
              sourceClientInstanceId: deviceId,
              agentRunId,
              occurredAt: createdAt,
              artifactLinks: [],
              eventType: "agent_run_presentation",
              mode: "collapsible",
              initialState: "collapsed",
              summaryMessageEventId: null,
              label: "Worked",
            },
          }),
        )
      ).status,
      "accepted",
    );

    // --- revision conflicts stay conflicts -------------------------------
    assert.equal(
      (
        await applySyncChange(
          database,
          owner,
          deviceId,
          change({
            protocolVersion: 1,
            changeId: randomUUID(),
            originClientInstanceId: deviceId,
            projectId,
            projectRevision: 1,
            payloadSchemaVersion: 1,
            createdAt,
            kind: "project.upsert",
            payload: {
              id: projectId,
              originClientInstanceId: deviceId,
              name: "Replayed revision",
              revision: 1,
              createdAt,
              updatedAt: createdAt,
              archivedAt: null,
              deletedAt: null,
            },
          }),
        )
      ).status,
      "conflict",
    );

    // --- reading back ----------------------------------------------------
    const pulled = await pullSyncChanges(database, owner, null, 100);
    assert.equal(pulled.changes.length, 7);
    assert.ok(pulled.nextCursor);

    // The whole point of the port: another organization's pull is empty even
    // though the rows sit in the same tables.
    const isolated = await pullSyncChanges(database, other.owner, null, 100);
    assert.equal(isolated.changes.length, 0);

    // Cursors are signed, so a hand-edited one is refused rather than obeyed.
    await assert.rejects(
      pullSyncChanges(database, owner, "999.not-a-signature", 100),
      /INVALID_CURSOR/,
    );

    // --- one membership cannot write over another's ----------------------
    // The upsert conflicts on the session's primary key, which is global, so
    // a membership-scoped existence check alone would read another tenant's
    // session as absent and take it over as a fresh revision 1.
    const takeover = await applySyncChange(
      database,
      other.owner,
      other.deviceId,
      change({
        protocolVersion: 1,
        changeId: randomUUID(),
        originClientInstanceId: other.deviceId,
        sessionId,
        sessionRevision: 1,
        payloadSchemaVersion: 1,
        createdAt,
        kind: "session.upsert",
        payload: {
          id: sessionId,
          originClientInstanceId: other.deviceId,
          projectId: null,
          title: "Stolen",
          status: "active",
          revision: 1,
          createdAt,
          updatedAt: createdAt,
          archivedAt: null,
          deletedAt: null,
        },
      }),
    );
    assert.equal(takeover.status, "rejected");
    assert.equal(takeover.errorCode, "SESSION_ID_REUSED");
    const [stillOurs] = await withSyncOwner(database, owner, (transaction) =>
      transaction
        .select({ membershipId: syncSessions.membershipId })
        .from(syncSessions)
        .where(eq(syncSessions.id, sessionId)),
    );
    assert.equal(stillOurs?.membershipId, owner.membershipId);

    const projectTakeover = await applySyncChange(
      database,
      other.owner,
      other.deviceId,
      change({
        protocolVersion: 1,
        changeId: randomUUID(),
        originClientInstanceId: other.deviceId,
        projectId,
        projectRevision: 1,
        payloadSchemaVersion: 1,
        createdAt,
        kind: "project.upsert",
        payload: {
          id: projectId,
          originClientInstanceId: other.deviceId,
          name: "Stolen",
          revision: 1,
          createdAt,
          updatedAt: createdAt,
          archivedAt: null,
          deletedAt: null,
        },
      }),
    );
    assert.equal(projectTakeover.status, "rejected");
    assert.equal(projectTakeover.errorCode, "PROJECT_ID_REUSED");

    // --- a bad change is a verdict, never a thrown request ----------------
    // A change the server will never accept has to come back as a result the
    // client can drop. If it threw, the client would keep it at the head of
    // its queue and retry it forever, stalling everything behind it.
    const probeSessionId = randomUUID();
    assert.equal(
      (
        await applySyncChange(
          database,
          owner,
          deviceId,
          change({
            protocolVersion: 1,
            changeId: randomUUID(),
            originClientInstanceId: deviceId,
            sessionId: probeSessionId,
            sessionRevision: 1,
            payloadSchemaVersion: 1,
            createdAt,
            kind: "session.upsert",
            payload: {
              id: probeSessionId,
              originClientInstanceId: deviceId,
              projectId: null,
              title: "Rejection probe",
              status: "active",
              revision: 1,
              createdAt,
              updatedAt: createdAt,
              archivedAt: null,
              deletedAt: null,
            },
          }),
        )
      ).status,
      "accepted",
    );

    const probeEvent = (
      eventId: string,
      revision: number,
      runId: string | null,
    ) =>
      change({
        protocolVersion: 1,
        changeId: randomUUID(),
        originClientInstanceId: deviceId,
        sessionId: probeSessionId,
        sessionRevision: revision,
        payloadSchemaVersion: 1,
        createdAt,
        kind: "session.event.append",
        payload: {
          eventId,
          sessionId: probeSessionId,
          sessionRevision: revision,
          sourceClientInstanceId: deviceId,
          agentRunId: runId,
          occurredAt: createdAt,
          artifactLinks: [],
          eventType: "reasoning_summary",
          summaryKind: "analysis",
          summaryText: "Rejection probe.",
        },
      });

    const danglingRun = await applySyncChange(
      database,
      owner,
      deviceId,
      probeEvent(randomUUID(), 2, randomUUID()),
    );
    assert.equal(danglingRun.status, "rejected");
    assert.equal(danglingRun.errorCode, "AGENT_RUN_NOT_FOUND");

    // A constraint the database enforces reaches the client the same way.
    const reusedEventId = randomUUID();
    assert.equal(
      (
        await applySyncChange(
          database,
          owner,
          deviceId,
          probeEvent(reusedEventId, 2, null),
        )
      ).status,
      "accepted",
    );
    const reusedEvent = await applySyncChange(
      database,
      owner,
      deviceId,
      probeEvent(reusedEventId, 3, null),
    );
    assert.equal(reusedEvent.status, "rejected");
    assert.equal(reusedEvent.errorCode, "CONSTRAINT_VIOLATION");

    // --- a revoked device stays revoked ----------------------------------
    // Re-registering used to clear revoked_at, so a lost machine that still
    // held a session token could hand itself back its own access.
    await withSyncOwner(database, other.owner, (transaction) =>
      transaction
        .update(syncDevices)
        .set({ revokedAt: new Date() })
        .where(eq(syncDevices.id, other.deviceId)),
    );
    await assert.rejects(
      withSyncOwner(database, other.owner, (transaction) =>
        verifyDeviceRequest(
          transaction,
          signedRequest,
          other.owner.membershipId,
          signedBody,
        ),
        ),
      /DEVICE_NOT_REGISTERED/,
    );

    // --- rows landed where they should -----------------------------------
    assert.equal(
      (
        await withSyncOwner(database, owner, (transaction) =>
          transaction
          .select({ id: syncProjects.id })
          .from(syncProjects)
          .where(
            and(
              eq(syncProjects.organizationId, owner.organizationId),
              eq(syncProjects.membershipId, owner.membershipId),
              eq(syncProjects.id, projectId),
            ),
          ),
      )
      ).length,
      1,
    );
    assert.ok(
      (
        await withSyncOwner(database, owner, (transaction) =>
          transaction
          .select({ id: syncReasoningSummaries.eventId })
          .from(syncReasoningSummaries),
      )
      ).length >= 1,
    );
    assert.equal(
      (
        await withSyncOwner(database, owner, (transaction) =>
          transaction
          .select({ id: syncFileArtifacts.artifactId })
          .from(syncFileArtifacts)
          .where(
            and(
              eq(syncFileArtifacts.membershipId, owner.membershipId),
              eq(syncFileArtifacts.artifactId, artifactId),
            ),
          ),
      )
      ).length,
      1,
    );
    assert.equal(
      (
        await withSyncOwner(database, owner, (transaction) =>
          transaction
          .select({ id: syncAgentRunPresentations.eventId })
          .from(syncAgentRunPresentations)
          .where(
            and(
              eq(syncAgentRunPresentations.agentRunId, agentRunId),
              eq(syncAgentRunPresentations.mode, "collapsible"),
            ),
          ),
      )
      ).length,
      1,
    );
    assert.equal(
      (
        await withSyncOwner(database, owner, (transaction) =>
          transaction
          .select({ id: syncFileChanges.eventId })
          .from(syncFileChanges)
          .where(
            and(
              eq(syncFileChanges.agentRunId, agentRunId),
              eq(syncFileChanges.projectFileId, projectFileId),
            ),
          ),
      )
      ).length,
      1,
    );

    console.info(
      "Platform sync verification passed: projections, cursor, device binding and organization isolation.",
    );
  } finally {
    // The directory goes first: if closing the pool throws, the temporary
    // artifacts would otherwise be left behind.
    await rm(artifactDirectory, { force: true, recursive: true });
    await pool.end();
  }
}

await main();
