import { and, eq, gt, inArray } from "drizzle-orm";

import {
  platformSchema,
  type PlatformDatabase,
} from "@curve-ai/platform-database";
import type {
  JsonValue,
  ProjectRecord,
  SessionEventRecord,
  SessionRecord,
  SyncChangeEnvelope,
} from "@curve-ai/radius-sync-protocol";

import { payloadSha256 } from "./canonical-json.js";
import { decodeCursor, encodeCursor } from "./cursor.js";

const {
  syncAgentRunPresentations,
  syncAgentRuns,
  syncAgentRunStateUpdates,
  syncApprovalDecisions,
  syncApprovalRequests,
  syncArtifacts,
  syncChanges,
  syncErrors,
  syncEventArtifacts,
  syncFileArtifacts,
  syncFileChanges,
  syncLinkArtifacts,
  syncMessageParts,
  syncMessages,
  syncProjectFiles,
  syncProjectFileVersions,
  syncProjects,
  syncReasoningSummaries,
  syncSessionEvents,
  syncSessions,
  syncTaskPlans,
  syncTaskSteps,
  syncTaskStepUpdates,
  syncToolCalls,
  syncToolProgressEvents,
  syncToolResults,
} = platformSchema;

/**
 * Who a change belongs to. Sync is per-person, but a person is only ever a
 * person *within an organization*, so ownership carries both.
 */
export interface SyncOwner {
  organizationId: string;
  membershipId: string;
}

export interface ChangeResult {
  changeId: string;
  status: "accepted" | "duplicate" | "conflict" | "rejected";
  errorCode: string | null;
}

type PlatformTransaction = Parameters<
  Parameters<PlatformDatabase["transaction"]>[0]
>[0];

async function insertArtifacts(
  transaction: PlatformTransaction,
  owner: SyncOwner,
  event: SessionEventRecord,
): Promise<void> {
  for (const link of event.artifactLinks) {
    const artifact = link.artifact;
    if (artifact.sessionId !== event.sessionId) {
      throw new Error("ARTIFACT_SESSION_MISMATCH");
    }
    await transaction.insert(syncArtifacts).values({
      id: artifact.id,
      ...owner,
      sessionId: artifact.sessionId,
      name: artifact.name,
      artifactType: artifact.artifactType,
      storageKind: artifact.storageKind,
      supersedesArtifactId: artifact.supersedesArtifactId,
      createdByEventId: event.eventId,
      createdAt: new Date(artifact.createdAt),
      deletedAt: artifact.deletedAt ? new Date(artifact.deletedAt) : null,
    });
    if (artifact.storageKind === "file") {
      await transaction.insert(syncFileArtifacts).values({
        artifactId: artifact.id,
        ...owner,
        mimeType: artifact.mimeType,
        contentSha256: artifact.contentSha256,
        byteSize: artifact.byteSize,
        availability: "metadata_only",
        remoteLocator: null,
      });
    } else {
      await transaction.insert(syncLinkArtifacts).values({
        artifactId: artifact.id,
        url: artifact.url,
        provider: artifact.provider,
        externalId: artifact.externalId,
      });
    }
    await transaction.insert(syncEventArtifacts).values({
      eventId: event.eventId,
      artifactId: artifact.id,
      relationship: link.relationship,
    });
  }
}

async function insertEventProjection(
  transaction: PlatformTransaction,
  owner: SyncOwner,
  event: SessionEventRecord,
  sessionProjectId: string | null,
): Promise<void> {
  if (event.agentRunId && event.eventType !== "agent_run") {
    const [run] = await transaction
      .select({ id: syncAgentRuns.id })
      .from(syncAgentRuns)
      .where(
        and(
          eq(syncAgentRuns.id, event.agentRunId),
          eq(syncAgentRuns.sessionId, event.sessionId),
        ),
      )
      .limit(1);
    if (!run) throw new Error("AGENT_RUN_NOT_FOUND");
  }

  await transaction.insert(syncSessionEvents).values({
    id: event.eventId,
    ...owner,
    sessionId: event.sessionId,
    sessionRevision: event.sessionRevision,
    eventType: event.eventType,
    agentRunId: event.agentRunId,
    sourceClientInstanceId: event.sourceClientInstanceId,
    occurredAt: new Date(event.occurredAt),
  });
  await insertArtifacts(transaction, owner, event);

  switch (event.eventType) {
    case "message":
      await transaction.insert(syncMessages).values({
        eventId: event.eventId,
        role: event.role,
        messageKind: event.messageKind,
        status: event.status,
        model: event.model,
        providerMessageId: event.providerMessageId,
        finishReason: event.finishReason,
      });
      if (event.parts.length > 0) {
        await transaction.insert(syncMessageParts).values(
          event.parts.map((part) => ({
            id: part.id,
            messageEventId: event.eventId,
            position: part.position,
            partType: part.partType,
            text: part.partType === "text" ? part.text : null,
            artifactId:
              part.partType === "artifact_reference" ? part.artifactId : null,
          })),
        );
      }
      return;
    case "agent_run":
      if (!event.agentRunId) throw new Error("AGENT_RUN_ID_REQUIRED");
      await transaction.insert(syncAgentRuns).values({
        id: event.agentRunId,
        eventId: event.eventId,
        sessionId: event.sessionId,
        providerKey: event.providerKey,
        providerRunId: event.providerRunId,
        triggeringMessageEventId: event.triggeringMessageEventId,
        startedAt: new Date(event.occurredAt),
      });
      return;
    case "agent_run_state_update":
      await transaction.insert(syncAgentRunStateUpdates).values({
        eventId: event.eventId,
        agentRunId: requiredRunId(event.agentRunId),
        state: event.state,
        detail: event.detail,
        occurredAt: new Date(event.occurredAt),
      });
      return;
    case "agent_run_presentation":
      await transaction.insert(syncAgentRunPresentations).values({
        eventId: event.eventId,
        agentRunId: requiredRunId(event.agentRunId),
        mode: event.mode,
        initialState: event.initialState,
        summaryMessageEventId: event.summaryMessageEventId,
        label: event.label,
      });
      return;
    case "reasoning_summary":
      await transaction.insert(syncReasoningSummaries).values({
        eventId: event.eventId,
        summaryKind: event.summaryKind,
        summaryText: event.summaryText,
      });
      return;
    case "task_plan":
      await transaction.insert(syncTaskPlans).values({
        id: event.planId,
        eventId: event.eventId,
        title: event.title,
        supersedesPlanId: event.supersedesPlanId,
        createdAt: new Date(event.occurredAt),
      });
      await transaction.insert(syncTaskSteps).values(
        event.steps.map((step) => ({
          id: step.id,
          planId: event.planId,
          position: step.position,
          title: step.title,
        })),
      );
      return;
    case "task_step_update":
      await transaction.insert(syncTaskStepUpdates).values({
        eventId: event.eventId,
        taskStepId: event.taskStepId,
        state: event.state,
        detail: event.detail,
      });
      return;
    case "tool_call":
      await transaction.insert(syncToolCalls).values({
        eventId: event.eventId,
        triggeringMessageEventId: event.triggeringMessageEventId,
        capability: event.capability,
        operation: event.operation,
        inputSchemaId: event.inputSchemaId,
        inputSchemaVersion: event.inputSchemaVersion,
        input: event.input,
      });
      return;
    case "tool_progress":
      await transaction.insert(syncToolProgressEvents).values({
        eventId: event.eventId,
        toolCallEventId: event.toolCallEventId,
        progressSchemaId: event.progressSchemaId,
        progressSchemaVersion: event.progressSchemaVersion,
        progress: event.progress,
      });
      return;
    case "tool_result":
      await transaction.insert(syncToolResults).values({
        eventId: event.eventId,
        toolCallEventId: event.toolCallEventId,
        outcome: event.outcome,
        outputSchemaId: event.outputSchemaId,
        outputSchemaVersion: event.outputSchemaVersion,
        output: event.output,
      });
      return;
    case "file_change":
      await insertFileChange(transaction, owner, event, sessionProjectId);
      return;
    case "approval_request":
      await transaction.insert(syncApprovalRequests).values({
        eventId: event.eventId,
        toolCallEventId: event.toolCallEventId,
        reason: event.reason,
        expiresAt: event.expiresAt ? new Date(event.expiresAt) : null,
      });
      return;
    case "approval_decision":
      await transaction.insert(syncApprovalDecisions).values({
        eventId: event.eventId,
        approvalRequestEventId: event.approvalRequestEventId,
        decision: event.decision,
        actorType: event.actorType,
        actorId: event.actorId,
        note: event.note,
      });
      return;
    case "error":
      await transaction.insert(syncErrors).values({
        eventId: event.eventId,
        code: event.code,
        message: event.message,
        retryable: event.retryable,
        detailsSchemaId: event.detailsSchemaId,
        details: event.details,
      });
  }
}

async function insertFileChange(
  transaction: PlatformTransaction,
  owner: SyncOwner,
  event: Extract<SessionEventRecord, { eventType: "file_change" }>,
  sessionProjectId: string | null,
): Promise<void> {
  if (sessionProjectId !== event.projectId) {
    throw new Error("FILE_CHANGE_PROJECT_MISMATCH");
  }
  const [existingFile] = await transaction
    .select()
    .from(syncProjectFiles)
    .where(eq(syncProjectFiles.id, event.projectFileId))
    .limit(1);
  if (
    existingFile &&
    (existingFile.membershipId !== owner.membershipId ||
      existingFile.projectId !== event.projectId ||
      existingFile.createdAt.getTime() !==
        Date.parse(event.projectFileCreatedAt))
  ) {
    throw new Error("PROJECT_FILE_ID_REUSED");
  }
  if (!existingFile) {
    await transaction.insert(syncProjectFiles).values({
      id: event.projectFileId,
      ...owner,
      projectId: event.projectId,
      createdAt: new Date(event.projectFileCreatedAt),
    });
  }

  const versions = [event.beforeVersion, event.afterVersion].filter(
    (version): version is NonNullable<typeof version> => version !== null,
  );
  const existingVersions =
    versions.length === 0
      ? []
      : await transaction
          .select()
          .from(syncProjectFileVersions)
          .where(
            inArray(
              syncProjectFileVersions.id,
              versions.map((item) => item.id),
            ),
          );
  const existingById = new Map(
    existingVersions.map((version) => [version.id, version]),
  );
  for (const version of versions) {
    const existing = existingById.get(version.id);
    if (existing) {
      if (
        existing.membershipId !== owner.membershipId ||
        existing.projectFileId !== event.projectFileId ||
        existing.relativePath !== version.relativePath ||
        existing.mimeType !== version.mimeType ||
        existing.contentSha256 !== version.contentSha256 ||
        existing.byteSize !== version.byteSize ||
        existing.capturedAt.getTime() !== Date.parse(version.capturedAt)
      ) {
        throw new Error("PROJECT_FILE_VERSION_ID_REUSED");
      }
      continue;
    }
    await transaction.insert(syncProjectFileVersions).values({
      id: version.id,
      ...owner,
      projectId: event.projectId,
      projectFileId: event.projectFileId,
      relativePath: version.relativePath,
      mimeType: version.mimeType,
      contentSha256: version.contentSha256,
      byteSize: version.byteSize,
      capturedAt: new Date(version.capturedAt),
      availability: "metadata_only",
    });
  }

  await transaction.insert(syncFileChanges).values({
    eventId: event.eventId,
    agentRunId: requiredRunId(event.agentRunId),
    projectId: event.projectId,
    projectFileId: event.projectFileId,
    toolCallEventId: event.toolCallEventId,
    operation: event.operation,
    beforeVersionId: event.beforeVersion?.id ?? null,
    afterVersionId: event.afterVersion?.id ?? null,
    textDiff: event.textDiff,
  });
}

export async function applySyncChange(
  database: PlatformDatabase,
  owner: SyncOwner,
  deviceId: string,
  change: SyncChangeEnvelope,
): Promise<ChangeResult> {
  return database.transaction(async (transaction) => {
    const [duplicate] = await transaction
      .select({ payloadSha256: syncChanges.payloadSha256 })
      .from(syncChanges)
      .where(
        and(
          eq(syncChanges.membershipId, owner.membershipId),
          eq(syncChanges.changeId, change.changeId),
        ),
      )
      .limit(1);
    if (duplicate) {
      return duplicate.payloadSha256 === change.payloadSha256
        ? accepted(change.changeId, "duplicate")
        : rejected(change.changeId, "CHANGE_ID_REUSED");
    }
    if (
      payloadSha256(change.payload as unknown as JsonValue) !==
      change.payloadSha256
    ) {
      return rejected(change.changeId, "PAYLOAD_HASH_MISMATCH");
    }
    if (change.originClientInstanceId !== deviceId) {
      return rejected(change.changeId, "ORIGIN_MISMATCH");
    }

    if (change.kind === "project.upsert" || change.kind === "project.delete") {
      return applyProjectChange(transaction, owner, deviceId, change);
    }
    return applySessionChange(transaction, owner, deviceId, change);
  });
}

async function applyProjectChange(
  transaction: PlatformTransaction,
  owner: SyncOwner,
  deviceId: string,
  change: Extract<
    SyncChangeEnvelope,
    { kind: "project.upsert" | "project.delete" }
  >,
): Promise<ChangeResult> {
  const [current] = await transaction
    .select()
    .from(syncProjects)
    .where(
      and(
        eq(syncProjects.membershipId, owner.membershipId),
        eq(syncProjects.id, change.projectId),
      ),
    )
    .for("update")
    .limit(1);
  if (change.projectRevision !== (current?.revision ?? 0) + 1) {
    return conflict(change.changeId, "REVISION_CONFLICT");
  }
  if (current && current.originDeviceId !== deviceId) {
    return rejected(change.changeId, "NOT_ORIGIN_DEVICE");
  }
  if (
    change.payload.id !== change.projectId ||
    change.payload.revision !== change.projectRevision ||
    change.payload.originClientInstanceId !== deviceId
  ) {
    return rejected(change.changeId, "PROJECT_PAYLOAD_MISMATCH");
  }
  if (change.kind === "project.delete" && !current) {
    return conflict(change.changeId, "PROJECT_NOT_FOUND");
  }

  const values = projectValues(owner, change.payload);
  await transaction
    .insert(syncProjects)
    .values(values)
    .onConflictDoUpdate({ target: syncProjects.id, set: values });
  await insertChange(transaction, owner, deviceId, change);
  return accepted(change.changeId);
}

async function applySessionChange(
  transaction: PlatformTransaction,
  owner: SyncOwner,
  deviceId: string,
  change: Exclude<
    SyncChangeEnvelope,
    { kind: "project.upsert" | "project.delete" }
  >,
): Promise<ChangeResult> {
  const [current] = await transaction
    .select()
    .from(syncSessions)
    .where(
      and(
        eq(syncSessions.membershipId, owner.membershipId),
        eq(syncSessions.id, change.sessionId),
      ),
    )
    .for("update")
    .limit(1);
  if (change.sessionRevision !== (current?.revision ?? 0) + 1) {
    return conflict(change.changeId, "REVISION_CONFLICT");
  }
  if (current && current.originDeviceId !== deviceId) {
    return rejected(change.changeId, "NOT_ORIGIN_DEVICE");
  }

  if (change.kind === "session.upsert") {
    if (
      change.payload.id !== change.sessionId ||
      change.payload.revision !== change.sessionRevision ||
      change.payload.originClientInstanceId !== deviceId
    ) {
      return rejected(change.changeId, "SESSION_PAYLOAD_MISMATCH");
    }
    if (change.payload.projectId) {
      const [project] = await transaction
        .select({ id: syncProjects.id })
        .from(syncProjects)
        .where(
          and(
            eq(syncProjects.membershipId, owner.membershipId),
            eq(syncProjects.id, change.payload.projectId),
          ),
        )
        .limit(1);
      if (!project) return conflict(change.changeId, "PROJECT_NOT_FOUND");
    }
    const values = sessionValues(owner, change.payload);
    await transaction
      .insert(syncSessions)
      .values(values)
      .onConflictDoUpdate({ target: syncSessions.id, set: values });
  } else if (change.kind === "session.event.append") {
    if (!current) return conflict(change.changeId, "SESSION_NOT_FOUND");
    if (
      change.payload.sessionId !== change.sessionId ||
      change.payload.sessionRevision !== change.sessionRevision ||
      change.payload.sourceClientInstanceId !== deviceId
    ) {
      return rejected(change.changeId, "EVENT_PAYLOAD_MISMATCH");
    }
    await insertEventProjection(
      transaction,
      owner,
      change.payload,
      current.projectId,
    );
    await transaction
      .update(syncSessions)
      .set({
        revision: change.sessionRevision,
        updatedAt: new Date(change.payload.occurredAt),
        acceptedAt: new Date(),
      })
      .where(eq(syncSessions.id, change.sessionId));
  } else {
    if (
      !current ||
      change.payload.deletedAt === null ||
      change.payload.originClientInstanceId !== deviceId ||
      change.payload.id !== change.sessionId ||
      change.payload.revision !== change.sessionRevision
    ) {
      return conflict(change.changeId, "SESSION_NOT_FOUND");
    }
    await transaction
      .update(syncSessions)
      .set(sessionValues(owner, change.payload))
      .where(eq(syncSessions.id, change.sessionId));
  }

  await insertChange(transaction, owner, deviceId, change);
  return accepted(change.changeId);
}

async function insertChange(
  transaction: PlatformTransaction,
  owner: SyncOwner,
  deviceId: string,
  change: SyncChangeEnvelope,
): Promise<void> {
  await transaction.insert(syncChanges).values({
    ...owner,
    changeId: change.changeId,
    originDeviceId: deviceId,
    projectId: "projectId" in change ? change.projectId : null,
    projectRevision:
      "projectRevision" in change ? change.projectRevision : null,
    sessionId: "sessionId" in change ? change.sessionId : null,
    sessionRevision:
      "sessionRevision" in change ? change.sessionRevision : null,
    kind: change.kind,
    payloadSha256: change.payloadSha256,
    envelope: change as unknown as Record<string, unknown>,
  });
}

export async function pullSyncChanges(
  database: PlatformDatabase,
  owner: SyncOwner,
  cursor: string | null,
  limit: number,
): Promise<{ changes: SyncChangeEnvelope[]; nextCursor: string | null }> {
  const after = cursor ? decodeCursor(cursor) : null;
  const rows = await database
    .select({ sequence: syncChanges.sequence, envelope: syncChanges.envelope })
    .from(syncChanges)
    .where(
      after === null
        ? eq(syncChanges.membershipId, owner.membershipId)
        : and(eq(syncChanges.membershipId, owner.membershipId), gt(syncChanges.sequence, after)),
    )
    .orderBy(syncChanges.sequence)
    .limit(limit);
  const last = rows.at(-1)?.sequence;
  return {
    changes: rows.map((row) => row.envelope as unknown as SyncChangeEnvelope),
    nextCursor: last ? encodeCursor(last) : cursor,
  };
}

function projectValues(owner: SyncOwner, project: ProjectRecord) {
  return {
    id: project.id,
    ...owner,
    originDeviceId: project.originClientInstanceId,
    name: project.name,
    revision: project.revision,
    createdAt: new Date(project.createdAt),
    updatedAt: new Date(project.updatedAt),
    archivedAt: project.archivedAt ? new Date(project.archivedAt) : null,
    deletedAt: project.deletedAt ? new Date(project.deletedAt) : null,
    acceptedAt: new Date(),
  };
}

function sessionValues(owner: SyncOwner, session: SessionRecord) {
  return {
    id: session.id,
    ...owner,
    originDeviceId: session.originClientInstanceId,
    projectId: session.projectId,
    title: session.title,
    status: session.status,
    revision: session.revision,
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt),
    archivedAt: session.archivedAt ? new Date(session.archivedAt) : null,
    deletedAt: session.deletedAt ? new Date(session.deletedAt) : null,
    acceptedAt: new Date(),
  };
}

function requiredRunId(value: string | null): string {
  if (!value) throw new Error("AGENT_RUN_ID_REQUIRED");
  return value;
}

function accepted(
  changeId: string,
  status: "accepted" | "duplicate" = "accepted",
): ChangeResult {
  return { changeId, status, errorCode: null };
}

function rejected(changeId: string, errorCode: string): ChangeResult {
  return { changeId, status: "rejected", errorCode };
}

function conflict(changeId: string, errorCode: string): ChangeResult {
  return { changeId, status: "conflict", errorCode };
}
