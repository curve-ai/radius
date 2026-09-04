import { randomUUID } from "node:crypto";

import {
  ProjectRecordSchema,
  SessionEventRecordSchema,
  SessionRecordSchema,
  SyncChangeEnvelopeSchema,
  type JsonValue,
  type ArtifactRecord,
  type PushChangeResult,
  type ProjectRecord,
  type SessionEventRecord,
  type SessionRecord,
  type SyncChangeEnvelope,
} from "@curve-ai/radius-sync-protocol";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  max,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { canonicalJson, sha256Hex } from "./canonical-json.js";
import type { RadiusDatabase } from "./database.js";
import {
  agentRunPresentations,
  agentRuns,
  agentRunStateUpdates,
  approvalDecisions,
  approvalRequests,
  artifactTransfers,
  artifacts,
  clientInstances,
  composerDrafts,
  errors,
  eventArtifacts,
  eventRuns,
  fileChanges,
  fileArtifacts,
  linkArtifacts,
  localChanges,
  messageParts,
  messages,
  projectRoots,
  projectFiles,
  projectFileVersions,
  projects,
  reasoningSummaries,
  sessionEvents,
  sessionPins,
  sessions,
  syncConnections,
  syncCursors,
  syncDeliveries,
  syncInbox,
  taskPlanEvents,
  taskPlans,
  taskStepUpdates,
  taskSteps,
  toolCalls,
  toolProgressEvents,
  toolResults,
} from "./schema.js";

type StorageTransaction = Parameters<
  Parameters<RadiusDatabase["db"]["transaction"]>[0]
>[0];

function retryDelayMs(attemptCount: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.min(attemptCount - 1, 6));
}

export interface CreateSessionInput {
  originClientInstanceId: string;
  projectId?: string | null;
  title: string;
  status?: SessionRecord["status"];
  now?: number;
}

export interface CreateProjectInput {
  originClientInstanceId: string;
  name: string;
  rootPaths?: readonly string[];
  now?: number;
}

export interface AddProjectRootInput {
  projectId: string;
  clientInstanceId: string;
  rootPath: string;
  now?: number;
}

export interface RemoveProjectRootInput {
  projectId: string;
  clientInstanceId: string;
  rootId: string;
}

export interface UpdateProjectNameInput {
  projectId: string;
  originClientInstanceId: string;
  name: string;
  now?: number;
}

export interface UpdateSessionTitleInput {
  sessionId: string;
  originClientInstanceId: string;
  title: string;
  now?: number;
}

export interface ProjectSummaryRecord extends ProjectRecord {
  roots: ProjectRootRecord[];
}

export interface ProjectRootRecord {
  id: string;
  rootPath: string;
}

export interface ProjectSessionRecord {
  id: string;
  projectId: string;
  title: string;
  status: SessionRecord["status"];
  createdAt: string;
  updatedAt: string;
  lastAssistantMessageAt: string | null;
  pinnedAt: string | null;
}

export interface RecentSessionRecord {
  id: string;
  title: string;
  status: SessionRecord["status"];
  createdAt: string;
  updatedAt: string;
  lastAssistantMessageAt: string | null;
  pinnedAt: string | null;
}

export interface SessionProjectContext {
  projectId: string | null;
}

export interface SessionTranscriptArtifactRecord extends Pick<
  ArtifactRecord,
  "id" | "name" | "artifactType" | "storageKind"
> {
  mimeType: string | null;
  availability: "local" | "remote_only" | "missing" | null;
  url: string | null;
}

export interface LocalFileArtifactRecord extends Pick<
  Extract<ArtifactRecord, { storageKind: "file" }>,
  | "id"
  | "sessionId"
  | "name"
  | "artifactType"
  | "mimeType"
  | "contentSha256"
  | "byteSize"
> {
  availability: "local" | "remote_only" | "missing";
  localRelativePath: string | null;
}

export type SessionTranscriptEventRecord =
  | {
      eventId: string;
      sessionRevision: number;
      occurredAt: string;
      agentRunId: string | null;
      eventType: "message";
      role: "user" | "assistant" | "system";
      messageKind:
        "prompt" | "progress" | "final" | "run_summary" | "system_notice";
      status: "completed" | "cancelled" | "failed";
      text: string;
      artifacts?: SessionTranscriptArtifactRecord[];
    }
  | {
      eventId: string;
      sessionRevision: number;
      occurredAt: string;
      agentRunId: string;
      eventType: "agent_run";
      providerKey: string;
    }
  | {
      eventId: string;
      sessionRevision: number;
      occurredAt: string;
      agentRunId: string;
      eventType: "agent_run_state_update";
      state:
        | "working"
        | "waiting_for_approval"
        | "waiting_for_user"
        | "completed"
        | "failed"
        | "cancelled";
      detail: string | null;
    }
  | {
      eventId: string;
      sessionRevision: number;
      occurredAt: string;
      agentRunId: string;
      eventType: "agent_run_presentation";
      mode: "inline" | "collapsible";
      initialState: "expanded" | "collapsed" | null;
      summaryMessageEventId: string | null;
      label: string | null;
    }
  | {
      eventId: string;
      sessionRevision: number;
      occurredAt: string;
      agentRunId: string | null;
      eventType: "reasoning_summary";
      summaryKind: "analysis" | "decision" | "handoff";
      summaryText: string;
    }
  | {
      eventId: string;
      sessionRevision: number;
      occurredAt: string;
      agentRunId: string | null;
      eventType: "task_plan";
      planId: string;
      title: string;
      supersedesPlanId: string | null;
      steps: Array<{
        id: string;
        position: number;
        title: string;
      }>;
    }
  | {
      eventId: string;
      sessionRevision: number;
      occurredAt: string;
      agentRunId: string | null;
      eventType: "task_step_update";
      taskStepId: string;
      state: "pending" | "in_progress" | "completed" | "blocked" | "skipped";
      detail: string | null;
    }
  | {
      eventId: string;
      sessionRevision: number;
      occurredAt: string;
      agentRunId: string | null;
      eventType: "tool_call";
      capability: string;
      operation: string;
      inputSchemaId: string;
      inputSchemaVersion: number;
      input: JsonValue;
    }
  | {
      eventId: string;
      sessionRevision: number;
      occurredAt: string;
      agentRunId: string | null;
      eventType: "tool_progress";
      toolCallEventId: string;
      progressSchemaId: string;
      progressSchemaVersion: number;
      progress: JsonValue;
    }
  | {
      eventId: string;
      sessionRevision: number;
      occurredAt: string;
      agentRunId: string | null;
      eventType: "tool_result";
      toolCallEventId: string;
      outcome: "succeeded" | "failed" | "cancelled";
      outputSchemaId: string;
      outputSchemaVersion: number;
      output: JsonValue;
    }
  | {
      eventId: string;
      sessionRevision: number;
      occurredAt: string;
      agentRunId: string | null;
      eventType: "approval_request";
      toolCallEventId: string;
      reason: string;
      expiresAt: string | null;
    }
  | {
      eventId: string;
      sessionRevision: number;
      occurredAt: string;
      agentRunId: string | null;
      eventType: "approval_decision";
      approvalRequestEventId: string;
      decision: "approved" | "denied" | "cancelled" | "expired";
      actorType: "user" | "organization_policy" | "system";
      note: string | null;
    }
  | {
      eventId: string;
      sessionRevision: number;
      occurredAt: string;
      agentRunId: string | null;
      eventType: "error";
      code: string;
      message: string;
      retryable: boolean;
    };

export interface SetSessionPinnedInput {
  clientInstanceId: string;
  sessionId: string;
  pinned: boolean;
  now?: number;
}

export interface SetSessionArchivedInput {
  originClientInstanceId: string;
  sessionId: string;
  now?: number;
}

export interface AppendEventOptions {
  fileLocations?: Readonly<Record<string, string>>;
  fileVersionLocations?: Readonly<Record<string, string>>;
}

export interface EnsureClientInstanceInput {
  id: string;
  displayName: string;
  platform: string;
  publicKeyJwk: string;
  now?: number;
}

export interface ClientInstanceRecord {
  id: string;
  displayName: string;
  platform: string;
  publicKeyJwk: string;
  isLocal: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface SyncConnectionRecord {
  id: string;
  providerKey: string;
  endpointUrl: string;
  credentialRef: string | null;
  remoteSubject: string | null;
  accountLabel: string | null;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ClaimedDelivery {
  attemptCount: number;
  change: SyncChangeEnvelope;
}

export interface ClaimedArtifactTransfer {
  artifactId: string;
  mimeType: string;
  contentSha256: string;
  byteSize: number;
  localRelativePath: string;
  attemptCount: number;
}

type FileChangeEvent = Extract<
  SessionEventRecord,
  { eventType: "file_change" }
>;

export interface AgentRunFileVersionOutcome {
  id: string;
  relativePath: string;
  mimeType: string;
  contentSha256: string;
  byteSize: number;
  availability: "local" | "missing";
  capturedAtMs: number;
}

export interface AgentRunFileOutcome {
  eventId: string;
  operation: FileChangeEvent["operation"];
  occurredAtMs: number;
  projectFileId: string;
  beforeVersion: AgentRunFileVersionOutcome | null;
  afterVersion: AgentRunFileVersionOutcome | null;
  textAdditions: number | null;
  textDeletions: number | null;
}

const beforeFileVersions = alias(projectFileVersions, "before_file_versions");
const afterFileVersions = alias(projectFileVersions, "after_file_versions");

function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

function toIso(value: number): string {
  return new Date(value).toISOString();
}

type LocalChangeInput = SyncChangeEnvelope extends infer Change
  ? Change extends SyncChangeEnvelope
    ? Omit<
        Change,
        | "protocolVersion"
        | "changeId"
        | "payloadSchemaVersion"
        | "payloadSha256"
      >
    : never
  : never;

// A placeholder that satisfies the digest format so the envelope can be
// validated before the digest it carries is known.
const UNHASHED = "0".repeat(64);

function prepareLocalChange(input: LocalChangeInput): {
  envelope: SyncChangeEnvelope;
  payloadJson: string;
} {
  // Hash what is sent, not what was handed in. Schema parsing normalizes the
  // payload (it trims strings and drops unknown keys), so hashing the input
  // would digest something nobody else ever sees: every reader re-hashes the
  // parsed payload and would read the difference as a corrupt change.
  const parsed = SyncChangeEnvelopeSchema.parse({
    ...input,
    protocolVersion: 1,
    changeId: randomUUID(),
    payloadSchemaVersion: 1,
    payloadSha256: UNHASHED,
  });
  const payloadJson = canonicalJson(asJsonValue(parsed.payload));
  const envelope = {
    ...parsed,
    payloadSha256: sha256Hex(payloadJson),
  } as SyncChangeEnvelope;
  return { envelope, payloadJson };
}

function assertRemoteOrigin(
  subject: "project" | "session",
  storedOriginClientInstanceId: string,
  incomingOriginClientInstanceId: string,
): void {
  if (storedOriginClientInstanceId !== incomingOriginClientInstanceId) {
    throw new Error(`Remote ${subject} origin client instance changed`);
  }
}

export async function listAgentRunFileOutcomes(
  database: RadiusDatabase,
  agentRunId: string,
): Promise<AgentRunFileOutcome[]> {
  const outcomes = await database.db
    .select({
      eventId: fileChanges.eventId,
      operation: fileChanges.operation,
      occurredAtMs: sessionEvents.occurredAtMs,
      projectFileId: fileChanges.projectFileId,
      textAdditions: fileChanges.textAdditions,
      textDeletions: fileChanges.textDeletions,
      beforeVersion: {
        id: beforeFileVersions.id,
        relativePath: beforeFileVersions.relativePath,
        mimeType: beforeFileVersions.mimeType,
        contentSha256: beforeFileVersions.contentSha256,
        byteSize: beforeFileVersions.byteSize,
        availability: beforeFileVersions.availability,
        capturedAtMs: beforeFileVersions.capturedAtMs,
      },
      afterVersion: {
        id: afterFileVersions.id,
        relativePath: afterFileVersions.relativePath,
        mimeType: afterFileVersions.mimeType,
        contentSha256: afterFileVersions.contentSha256,
        byteSize: afterFileVersions.byteSize,
        availability: afterFileVersions.availability,
        capturedAtMs: afterFileVersions.capturedAtMs,
      },
    })
    .from(eventRuns)
    .innerJoin(fileChanges, eq(eventRuns.eventId, fileChanges.eventId))
    .innerJoin(sessionEvents, eq(eventRuns.eventId, sessionEvents.id))
    .leftJoin(
      beforeFileVersions,
      eq(fileChanges.beforeVersionId, beforeFileVersions.id),
    )
    .leftJoin(
      afterFileVersions,
      eq(fileChanges.afterVersionId, afterFileVersions.id),
    )
    .where(eq(eventRuns.agentRunId, agentRunId))
    .orderBy(asc(sessionEvents.sessionRevision));

  for (const outcome of outcomes) {
    if (!outcome.beforeVersion && !outcome.afterVersion) {
      throw new Error("File outcome references missing versions");
    }
  }
  return outcomes;
}

async function addDeliveriesForEnabledConnections(
  tx: StorageTransaction,
  changeId: string,
): Promise<void> {
  const connections = await tx
    .select({ id: syncConnections.id })
    .from(syncConnections)
    .where(eq(syncConnections.enabled, true));

  if (connections.length === 0) return;
  await tx.insert(syncDeliveries).values(
    connections.map((connection) => ({
      connectionId: connection.id,
      changeId,
    })),
  );
}

async function insertLocalChange(
  tx: StorageTransaction,
  envelope: ReturnType<typeof SyncChangeEnvelopeSchema.parse>,
  payloadJson: string,
): Promise<void> {
  const projectChange =
    envelope.kind === "project.upsert" || envelope.kind === "project.delete";
  await tx.insert(localChanges).values({
    id: envelope.changeId,
    originClientInstanceId: envelope.originClientInstanceId,
    projectId: projectChange ? envelope.projectId : null,
    projectRevision: projectChange ? envelope.projectRevision : null,
    sessionId: projectChange ? null : envelope.sessionId,
    sessionRevision: projectChange ? null : envelope.sessionRevision,
    eventId:
      envelope.kind === "session.event.append"
        ? envelope.payload.eventId
        : null,
    kind: envelope.kind,
    payloadSchemaVersion: envelope.payloadSchemaVersion,
    payloadJson,
    payloadSha256: envelope.payloadSha256,
    createdAtMs: Date.parse(envelope.createdAt),
  });
  await addDeliveriesForEnabledConnections(tx, envelope.changeId);
}

async function assertEventInSession(
  tx: StorageTransaction,
  eventId: string,
  sessionId: string,
): Promise<void> {
  const [related] = await tx
    .select({ id: sessionEvents.id })
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.id, eventId),
        eq(sessionEvents.sessionId, sessionId),
      ),
    )
    .limit(1);
  if (!related)
    throw new Error(
      "Related event belongs to another session or does not exist",
    );
}

async function assertAgentRunInSession(
  tx: StorageTransaction,
  agentRunId: string,
  sessionId: string,
): Promise<void> {
  const [run] = await tx
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(eq(agentRuns.id, agentRunId), eq(agentRuns.sessionId, sessionId)),
    )
    .limit(1);
  if (!run) {
    throw new Error("Agent run belongs to another session or does not exist");
  }
}

async function associateEventWithRun(
  tx: StorageTransaction,
  event: SessionEventRecord,
): Promise<void> {
  if (event.agentRunId === null) return;
  await assertAgentRunInSession(tx, event.agentRunId, event.sessionId);
  await tx.insert(eventRuns).values({
    eventId: event.eventId,
    agentRunId: event.agentRunId,
  });
}

async function insertProjectFileVersion(
  tx: StorageTransaction,
  event: FileChangeEvent,
  version: NonNullable<FileChangeEvent["beforeVersion"]>,
  fileVersionLocations: Readonly<Record<string, string>>,
  requireLocalFiles: boolean,
): Promise<void> {
  const [existing] = await tx
    .select()
    .from(projectFileVersions)
    .where(eq(projectFileVersions.id, version.id))
    .limit(1);
  if (existing) {
    if (
      existing.projectFileId !== event.projectFileId ||
      existing.relativePath !== version.relativePath ||
      existing.mimeType !== version.mimeType ||
      existing.contentSha256 !== version.contentSha256 ||
      existing.byteSize !== version.byteSize ||
      existing.capturedAtMs !== Date.parse(version.capturedAt)
    ) {
      throw new Error("Project file version identity was reused");
    }
    return;
  }

  const localRelativePath = fileVersionLocations[version.id];
  if (requireLocalFiles && !localRelativePath) {
    throw new Error(`Missing local file version for ${version.id}`);
  }
  await tx.insert(projectFileVersions).values({
    id: version.id,
    projectFileId: event.projectFileId,
    relativePath: version.relativePath,
    mimeType: version.mimeType,
    contentSha256: version.contentSha256,
    byteSize: version.byteSize,
    availability: localRelativePath ? "local" : "missing",
    localRelativePath: localRelativePath ?? null,
    capturedAtMs: Date.parse(version.capturedAt),
  });
}

async function insertFileChange(
  tx: StorageTransaction,
  event: FileChangeEvent,
  sessionProjectId: string | null,
  fileVersionLocations: Readonly<Record<string, string>>,
  requireLocalFiles: boolean,
): Promise<void> {
  if (sessionProjectId !== event.projectId) {
    throw new Error("File changes must target the session project");
  }
  if (event.toolCallEventId) {
    await assertEventInSession(tx, event.toolCallEventId, event.sessionId);
  }

  const [existingFile] = await tx
    .select()
    .from(projectFiles)
    .where(eq(projectFiles.id, event.projectFileId))
    .limit(1);
  if (existingFile && existingFile.projectId !== event.projectId) {
    throw new Error("Project file identity belongs to another project");
  }
  if (
    existingFile &&
    existingFile.createdAtMs !== Date.parse(event.projectFileCreatedAt)
  ) {
    throw new Error("Project file identity was reused");
  }
  if (!existingFile) {
    await tx.insert(projectFiles).values({
      id: event.projectFileId,
      projectId: event.projectId,
      createdAtMs: Date.parse(event.projectFileCreatedAt),
    });
  }

  if (event.beforeVersion) {
    await insertProjectFileVersion(
      tx,
      event,
      event.beforeVersion,
      fileVersionLocations,
      requireLocalFiles,
    );
  }
  if (event.afterVersion) {
    await insertProjectFileVersion(
      tx,
      event,
      event.afterVersion,
      fileVersionLocations,
      requireLocalFiles,
    );
  }

  await tx.insert(fileChanges).values({
    eventId: event.eventId,
    projectFileId: event.projectFileId,
    toolCallEventId: event.toolCallEventId,
    operation: event.operation,
    beforeVersionId: event.beforeVersion?.id ?? null,
    afterVersionId: event.afterVersion?.id ?? null,
    textAdditions: event.textDiff?.additions ?? null,
    textDeletions: event.textDiff?.deletions ?? null,
  });
}

interface InsertEventSubtypeOptions {
  fileVersionLocations: Readonly<Record<string, string>>;
  requireLocalFiles: boolean;
  sessionProjectId: string | null;
}

async function insertArtifacts(
  tx: StorageTransaction,
  event: SessionEventRecord,
  fileLocations: Readonly<Record<string, string>>,
  requireLocalFiles = true,
): Promise<void> {
  let enabledConnectionIds: string[] | null = null;
  for (const link of event.artifactLinks) {
    const artifact = link.artifact;
    if (artifact.sessionId !== event.sessionId) {
      throw new Error("Artifact and event must belong to the same session");
    }
    if (artifact.supersedesArtifactId) {
      const [superseded] = await tx
        .select({ sessionId: artifacts.sessionId })
        .from(artifacts)
        .where(eq(artifacts.id, artifact.supersedesArtifactId))
        .limit(1);
      if (!superseded || superseded.sessionId !== event.sessionId) {
        throw new Error("Superseded artifact must exist in the same session");
      }
    }

    await tx.insert(artifacts).values({
      id: artifact.id,
      sessionId: artifact.sessionId,
      name: artifact.name,
      artifactType: artifact.artifactType,
      createdByEventId: event.eventId,
      supersedesArtifactId: artifact.supersedesArtifactId,
      createdAtMs: Date.parse(artifact.createdAt),
      deletedAtMs: artifact.deletedAt ? Date.parse(artifact.deletedAt) : null,
    });

    if (artifact.storageKind === "file") {
      const localRelativePath = fileLocations[artifact.id];
      if (requireLocalFiles && !localRelativePath) {
        throw new Error(
          `Missing local file location for artifact ${artifact.id}`,
        );
      }
      await tx.insert(fileArtifacts).values({
        artifactId: artifact.id,
        mimeType: artifact.mimeType,
        contentSha256: artifact.contentSha256,
        byteSize: artifact.byteSize,
        availability: localRelativePath ? "local" : "remote_only",
        localRelativePath: localRelativePath ?? null,
      });
      if (localRelativePath) {
        enabledConnectionIds ??= (
          await tx
            .select({ id: syncConnections.id })
            .from(syncConnections)
            .where(eq(syncConnections.enabled, true))
        ).map((connection) => connection.id);
        if (enabledConnectionIds.length > 0) {
          await tx.insert(artifactTransfers).values(
            enabledConnectionIds.map((connectionId) => ({
              connectionId,
              artifactId: artifact.id,
            })),
          );
        }
      }
    } else {
      await tx.insert(linkArtifacts).values({
        artifactId: artifact.id,
        url: artifact.url,
        provider: artifact.provider,
        externalId: artifact.externalId,
      });
    }

    await tx.insert(eventArtifacts).values({
      eventId: event.eventId,
      artifactId: artifact.id,
      relationship: link.relationship,
    });
  }
}

async function insertEventSubtype(
  tx: StorageTransaction,
  event: SessionEventRecord,
  options: InsertEventSubtypeOptions,
): Promise<void> {
  switch (event.eventType) {
    case "message":
      await tx.insert(messages).values({
        eventId: event.eventId,
        role: event.role,
        messageKind: event.messageKind,
        status: event.status,
        model: event.model,
        providerMessageId: event.providerMessageId,
        finishReason: event.finishReason,
      });
      await tx.insert(messageParts).values(
        event.parts.map((part) =>
          part.partType === "text"
            ? {
                id: part.id,
                messageEventId: event.eventId,
                position: part.position,
                partType: part.partType,
                textContent: part.text,
              }
            : {
                id: part.id,
                messageEventId: event.eventId,
                position: part.position,
                partType: part.partType,
                artifactId: part.artifactId,
              },
        ),
      );
      return;
    case "agent_run":
      if (!event.agentRunId) {
        throw new Error("Agent run events require an agent run identifier");
      }
      if (event.triggeringMessageEventId) {
        await assertEventInSession(
          tx,
          event.triggeringMessageEventId,
          event.sessionId,
        );
      }
      await tx.insert(agentRuns).values({
        id: event.agentRunId,
        sessionId: event.sessionId,
        createdByEventId: event.eventId,
        providerKey: event.providerKey,
        providerRunId: event.providerRunId,
        triggeringMessageEventId: event.triggeringMessageEventId,
        startedAtMs: Date.parse(event.occurredAt),
      });
      return;
    case "agent_run_state_update":
      if (!event.agentRunId) {
        throw new Error("Agent run state updates require an agent run");
      }
      await tx.insert(agentRunStateUpdates).values({
        eventId: event.eventId,
        agentRunId: event.agentRunId,
        state: event.state,
        detail: event.detail,
      });
      return;
    case "agent_run_presentation":
      if (!event.agentRunId) {
        throw new Error("Agent run presentations require an agent run");
      }
      if (event.summaryMessageEventId) {
        await assertEventInSession(
          tx,
          event.summaryMessageEventId,
          event.sessionId,
        );
      }
      await tx.insert(agentRunPresentations).values({
        eventId: event.eventId,
        agentRunId: event.agentRunId,
        mode: event.mode,
        initialState: event.initialState,
        summaryMessageEventId: event.summaryMessageEventId,
        label: event.label,
      });
      return;
    case "reasoning_summary":
      await tx.insert(reasoningSummaries).values({
        eventId: event.eventId,
        summaryText: event.summaryText,
        summaryKind: event.summaryKind,
      });
      return;
    case "task_plan":
      if (event.supersedesPlanId) {
        const [previous] = await tx
          .select({ id: taskPlans.id })
          .from(taskPlans)
          .where(
            and(
              eq(taskPlans.id, event.supersedesPlanId),
              eq(taskPlans.sessionId, event.sessionId),
            ),
          )
          .limit(1);
        if (!previous)
          throw new Error("Superseded plan must exist in the same session");
      }
      await tx.insert(taskPlans).values({
        id: event.planId,
        sessionId: event.sessionId,
        title: event.title,
        supersedesPlanId: event.supersedesPlanId,
        createdAtMs: Date.parse(event.occurredAt),
      });
      await tx.insert(taskSteps).values(
        event.steps.map((step) => ({
          id: step.id,
          planId: event.planId,
          position: step.position,
          title: step.title,
        })),
      );
      await tx.insert(taskPlanEvents).values({
        eventId: event.eventId,
        planId: event.planId,
      });
      return;
    case "task_step_update": {
      const [step] = await tx
        .select({ id: taskSteps.id })
        .from(taskSteps)
        .innerJoin(taskPlans, eq(taskSteps.planId, taskPlans.id))
        .where(
          and(
            eq(taskSteps.id, event.taskStepId),
            eq(taskPlans.sessionId, event.sessionId),
          ),
        )
        .limit(1);
      if (!step) throw new Error("Task step must belong to the event session");
      await tx.insert(taskStepUpdates).values({
        eventId: event.eventId,
        taskStepId: event.taskStepId,
        state: event.state,
        detail: event.detail,
      });
      return;
    }
    case "tool_call":
      if (event.triggeringMessageEventId) {
        await assertEventInSession(
          tx,
          event.triggeringMessageEventId,
          event.sessionId,
        );
      }
      await tx.insert(toolCalls).values({
        eventId: event.eventId,
        triggeringMessageEventId: event.triggeringMessageEventId,
        capability: event.capability,
        operation: event.operation,
        inputSchemaId: event.inputSchemaId,
        inputSchemaVersion: event.inputSchemaVersion,
        inputJson: canonicalJson(event.input),
      });
      return;
    case "tool_progress":
      await assertEventInSession(tx, event.toolCallEventId, event.sessionId);
      await tx.insert(toolProgressEvents).values({
        eventId: event.eventId,
        toolCallEventId: event.toolCallEventId,
        progressSchemaId: event.progressSchemaId,
        progressSchemaVersion: event.progressSchemaVersion,
        progressJson: canonicalJson(event.progress),
      });
      return;
    case "tool_result":
      await assertEventInSession(tx, event.toolCallEventId, event.sessionId);
      await tx.insert(toolResults).values({
        eventId: event.eventId,
        toolCallEventId: event.toolCallEventId,
        outcome: event.outcome,
        outputSchemaId: event.outputSchemaId,
        outputSchemaVersion: event.outputSchemaVersion,
        outputJson: canonicalJson(event.output),
      });
      return;
    case "file_change":
      await insertFileChange(
        tx,
        event,
        options.sessionProjectId,
        options.fileVersionLocations,
        options.requireLocalFiles,
      );
      return;
    case "approval_request":
      await assertEventInSession(tx, event.toolCallEventId, event.sessionId);
      await tx.insert(approvalRequests).values({
        eventId: event.eventId,
        toolCallEventId: event.toolCallEventId,
        reason: event.reason,
        expiresAtMs: event.expiresAt ? Date.parse(event.expiresAt) : null,
      });
      return;
    case "approval_decision":
      await assertEventInSession(
        tx,
        event.approvalRequestEventId,
        event.sessionId,
      );
      await tx.insert(approvalDecisions).values({
        eventId: event.eventId,
        approvalRequestEventId: event.approvalRequestEventId,
        decision: event.decision,
        actorType: event.actorType,
        actorId: event.actorId,
        note: event.note,
      });
      return;
    case "error":
      await tx.insert(errors).values({
        eventId: event.eventId,
        code: event.code,
        message: event.message,
        retryable: event.retryable,
        detailsSchemaId: event.detailsSchemaId,
        detailsJson:
          event.details === null ? null : canonicalJson(event.details),
      });
  }
}

export async function ensureClientInstance(
  database: RadiusDatabase,
  input: EnsureClientInstanceInput,
): Promise<ClientInstanceRecord> {
  const existing = await database.db
    .select()
    .from(clientInstances)
    .where(eq(clientInstances.isLocal, true))
    .limit(2);
  if (existing.length > 1) {
    throw new Error("Radius storage contains more than one client instance");
  }
  if (existing[0]) {
    if (
      existing[0].id !== input.id ||
      existing[0].publicKeyJwk !== input.publicKeyJwk
    ) {
      throw new Error(
        "Client instance identity does not match the credential vault",
      );
    }
    return existing[0];
  }

  const now = input.now ?? Date.now();
  const record = {
    id: input.id,
    displayName: input.displayName,
    platform: input.platform,
    publicKeyJwk: input.publicKeyJwk,
    isLocal: true,
    createdAtMs: now,
    updatedAtMs: now,
  };
  await database.db.insert(clientInstances).values(record);
  return record;
}

export async function createProject(
  database: RadiusDatabase,
  input: CreateProjectInput,
): Promise<ProjectSummaryRecord> {
  const now = input.now ?? Date.now();
  const project = ProjectRecordSchema.parse({
    id: randomUUID(),
    originClientInstanceId: input.originClientInstanceId,
    name: input.name,
    revision: 1,
    createdAt: toIso(now),
    updatedAt: toIso(now),
    archivedAt: null,
    deletedAt: null,
  });
  const rootPaths = (input.rootPaths ?? []).map((rootPath) => rootPath.trim());
  if (rootPaths.some((rootPath) => !rootPath)) {
    throw new Error("Project source folders cannot be empty");
  }
  if (new Set(rootPaths).size !== rootPaths.length) {
    throw new Error("Project source folders must be unique");
  }
  const roots = rootPaths.map((rootPath) => ({
    id: randomUUID(),
    rootPath,
  }));

  const { envelope, payloadJson } = prepareLocalChange({
    originClientInstanceId: project.originClientInstanceId,
    projectId: project.id,
    projectRevision: project.revision,
    createdAt: project.createdAt,
    kind: "project.upsert",
    payload: project,
  });

  await database.db.transaction(async (tx) => {
    const [origin] = await tx
      .select({ id: clientInstances.id })
      .from(clientInstances)
      .where(
        and(
          eq(clientInstances.id, project.originClientInstanceId),
          eq(clientInstances.isLocal, true),
        ),
      )
      .limit(1);
    if (!origin) throw new Error("Project origin must be the local client");

    await tx.insert(projects).values({
      id: project.id,
      originClientInstanceId: project.originClientInstanceId,
      name: project.name,
      revision: project.revision,
      createdAtMs: now,
      updatedAtMs: now,
    });
    if (roots.length > 0) {
      await tx.insert(projectRoots).values(
        roots.map((root) => ({
          id: root.id,
          projectId: project.id,
          clientInstanceId: project.originClientInstanceId,
          rootPath: root.rootPath,
          createdAtMs: now,
          updatedAtMs: now,
        })),
      );
    }
    await insertLocalChange(tx, envelope, payloadJson);
  });

  return { ...project, roots };
}

export async function updateProjectName(
  database: RadiusDatabase,
  input: UpdateProjectNameInput,
): Promise<ProjectRecord> {
  const now = input.now ?? Date.now();
  const name = input.name.trim();
  if (!name) throw new Error("Project name is required");

  return database.db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, input.projectId),
          eq(projects.originClientInstanceId, input.originClientInstanceId),
          isNull(projects.deletedAtMs),
        ),
      )
      .limit(1);
    if (!current) {
      throw new Error("Only the local origin can edit this project");
    }

    const project = ProjectRecordSchema.parse({
      id: current.id,
      originClientInstanceId: current.originClientInstanceId,
      name,
      revision: current.revision + 1,
      createdAt: toIso(current.createdAtMs),
      updatedAt: toIso(now),
      archivedAt: current.archivedAtMs ? toIso(current.archivedAtMs) : null,
      deletedAt: null,
    });
    const { envelope, payloadJson } = prepareLocalChange({
      originClientInstanceId: project.originClientInstanceId,
      projectId: project.id,
      projectRevision: project.revision,
      createdAt: project.updatedAt,
      kind: "project.upsert",
      payload: project,
    });

    const updated = await tx
      .update(projects)
      .set({
        name: project.name,
        revision: project.revision,
        updatedAtMs: now,
      })
      .where(
        and(
          eq(projects.id, current.id),
          eq(projects.revision, current.revision),
        ),
      )
      .returning({ id: projects.id });
    if (updated.length !== 1) {
      throw new Error("Project revision changed concurrently");
    }
    await insertLocalChange(tx, envelope, payloadJson);
    return project;
  });
}

export async function addProjectRoot(
  database: RadiusDatabase,
  input: AddProjectRootInput,
): Promise<ProjectRootRecord> {
  const rootPath = input.rootPath.trim();
  if (!rootPath) throw new Error("Project source folder is required");
  const now = input.now ?? Date.now();
  const root: ProjectRootRecord = { id: randomUUID(), rootPath };

  await database.db.transaction(async (tx) => {
    const [localClient] = await tx
      .select({ id: clientInstances.id })
      .from(clientInstances)
      .where(
        and(
          eq(clientInstances.id, input.clientInstanceId),
          eq(clientInstances.isLocal, true),
        ),
      )
      .limit(1);
    if (!localClient)
      throw new Error("Project root must belong to this client");

    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(eq(projects.id, input.projectId), isNull(projects.deletedAtMs)),
      )
      .limit(1);
    if (!project) throw new Error("Project does not exist");

    await tx.insert(projectRoots).values({
      id: root.id,
      projectId: input.projectId,
      clientInstanceId: input.clientInstanceId,
      rootPath,
      createdAtMs: now,
      updatedAtMs: now,
    });
  });

  return root;
}

export async function removeProjectRoot(
  database: RadiusDatabase,
  input: RemoveProjectRootInput,
): Promise<void> {
  const removed = await database.db
    .delete(projectRoots)
    .where(
      and(
        eq(projectRoots.id, input.rootId),
        eq(projectRoots.projectId, input.projectId),
        eq(projectRoots.clientInstanceId, input.clientInstanceId),
      ),
    )
    .returning({ id: projectRoots.id });
  if (removed.length !== 1) {
    throw new Error("Project source folder does not exist on this client");
  }
}

export async function listProjects(
  database: RadiusDatabase,
  clientInstanceId: string,
): Promise<ProjectSummaryRecord[]> {
  const projectRows = await database.db
    .select()
    .from(projects)
    .where(and(isNull(projects.archivedAtMs), isNull(projects.deletedAtMs)))
    .orderBy(desc(projects.updatedAtMs), asc(projects.name));
  const rootRows =
    projectRows.length === 0
      ? []
      : await database.db
          .select({
            id: projectRoots.id,
            projectId: projectRoots.projectId,
            rootPath: projectRoots.rootPath,
          })
          .from(projectRoots)
          .where(
            and(
              eq(projectRoots.clientInstanceId, clientInstanceId),
              inArray(
                projectRoots.projectId,
                projectRows.map((project) => project.id),
              ),
            ),
          )
          .orderBy(asc(projectRoots.createdAtMs), asc(projectRoots.rootPath));
  const rootsByProject = new Map<string, ProjectRootRecord[]>();
  for (const root of rootRows) {
    const roots = rootsByProject.get(root.projectId) ?? [];
    roots.push({ id: root.id, rootPath: root.rootPath });
    rootsByProject.set(root.projectId, roots);
  }

  return projectRows.map((project) => ({
    id: project.id,
    originClientInstanceId: project.originClientInstanceId,
    name: project.name,
    revision: project.revision,
    createdAt: toIso(project.createdAtMs),
    updatedAt: toIso(project.updatedAtMs),
    archivedAt: project.archivedAtMs ? toIso(project.archivedAtMs) : null,
    deletedAt: project.deletedAtMs ? toIso(project.deletedAtMs) : null,
    roots: rootsByProject.get(project.id) ?? [],
  }));
}

async function queryProjectSessions(
  database: RadiusDatabase,
  clientInstanceId: string,
  projectId?: string,
): Promise<ProjectSessionRecord[]> {
  const rows = await database.db
    .select({
      id: sessions.id,
      projectId: sessions.projectId,
      title: sessions.title,
      status: sessions.status,
      createdAtMs: sessions.createdAtMs,
      updatedAtMs: sessions.updatedAtMs,
      pinnedAtMs: sessionPins.pinnedAtMs,
    })
    .from(sessions)
    .leftJoin(
      sessionPins,
      and(
        eq(sessionPins.sessionId, sessions.id),
        eq(sessionPins.clientInstanceId, clientInstanceId),
      ),
    )
    .where(
      and(
        projectId === undefined
          ? isNotNull(sessions.projectId)
          : eq(sessions.projectId, projectId),
        isNull(sessions.archivedAtMs),
        isNull(sessions.deletedAtMs),
      ),
    )
    .orderBy(desc(sessions.updatedAtMs));

  const lastAssistantMessageAt = await queryLastAssistantMessageAt(
    database,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId!,
    title: row.title,
    status: row.status,
    createdAt: toIso(row.createdAtMs),
    updatedAt: toIso(row.updatedAtMs),
    lastAssistantMessageAt: lastAssistantMessageAt.get(row.id) ?? null,
    pinnedAt: row.pinnedAtMs ? toIso(row.pinnedAtMs) : null,
  }));
}

async function queryLastAssistantMessageAt(
  database: RadiusDatabase,
  sessionIds: readonly string[],
): Promise<Map<string, string>> {
  if (sessionIds.length === 0) return new Map();

  const rows = await database.db
    .select({
      sessionId: sessionEvents.sessionId,
      occurredAtMs: max(sessionEvents.occurredAtMs),
    })
    .from(sessionEvents)
    .innerJoin(messages, eq(messages.eventId, sessionEvents.id))
    .where(
      and(
        inArray(sessionEvents.sessionId, sessionIds),
        eq(messages.role, "assistant"),
      ),
    )
    .groupBy(sessionEvents.sessionId);

  return new Map(
    rows.flatMap((row) =>
      row.occurredAtMs === null
        ? []
        : [[row.sessionId, toIso(row.occurredAtMs)] as const],
    ),
  );
}

export async function listProjectSessions(
  database: RadiusDatabase,
  projectId: string,
  clientInstanceId: string,
): Promise<ProjectSessionRecord[]> {
  return queryProjectSessions(database, clientInstanceId, projectId);
}

export async function listAllProjectSessions(
  database: RadiusDatabase,
  clientInstanceId: string,
): Promise<ProjectSessionRecord[]> {
  return queryProjectSessions(database, clientInstanceId);
}

export async function listRecentSessions(
  database: RadiusDatabase,
  clientInstanceId: string,
): Promise<RecentSessionRecord[]> {
  const rows = await database.db
    .select({
      id: sessions.id,
      title: sessions.title,
      status: sessions.status,
      createdAtMs: sessions.createdAtMs,
      updatedAtMs: sessions.updatedAtMs,
      pinnedAtMs: sessionPins.pinnedAtMs,
    })
    .from(sessions)
    .leftJoin(
      sessionPins,
      and(
        eq(sessionPins.sessionId, sessions.id),
        eq(sessionPins.clientInstanceId, clientInstanceId),
      ),
    )
    .where(
      and(
        isNull(sessions.projectId),
        isNull(sessions.archivedAtMs),
        isNull(sessions.deletedAtMs),
      ),
    )
    .orderBy(desc(sessions.updatedAtMs));

  const lastAssistantMessageAt = await queryLastAssistantMessageAt(
    database,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: toIso(row.createdAtMs),
    updatedAt: toIso(row.updatedAtMs),
    lastAssistantMessageAt: lastAssistantMessageAt.get(row.id) ?? null,
    pinnedAt: row.pinnedAtMs ? toIso(row.pinnedAtMs) : null,
  }));
}

export async function getSessionRevision(
  database: RadiusDatabase,
  sessionId: string,
): Promise<number | null> {
  const [session] = await database.db
    .select({ revision: sessions.revision })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), isNull(sessions.deletedAtMs)))
    .limit(1);
  return session?.revision ?? null;
}

export async function getLocalFileArtifact(
  database: RadiusDatabase,
  sessionId: string,
  artifactId: string,
): Promise<LocalFileArtifactRecord | null> {
  const [row] = await database.db
    .select({
      id: artifacts.id,
      sessionId: artifacts.sessionId,
      name: artifacts.name,
      artifactType: artifacts.artifactType,
      mimeType: fileArtifacts.mimeType,
      contentSha256: fileArtifacts.contentSha256,
      byteSize: fileArtifacts.byteSize,
      availability: fileArtifacts.availability,
      localRelativePath: fileArtifacts.localRelativePath,
    })
    .from(artifacts)
    .innerJoin(fileArtifacts, eq(fileArtifacts.artifactId, artifacts.id))
    .where(
      and(
        eq(artifacts.id, artifactId),
        eq(artifacts.sessionId, sessionId),
        isNull(artifacts.deletedAtMs),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listSessionTranscript(
  database: RadiusDatabase,
  sessionId: string,
): Promise<SessionTranscriptEventRecord[]> {
  const rowsQuery = database.db
    .select({
      eventId: sessionEvents.id,
      sessionRevision: sessionEvents.sessionRevision,
      eventType: sessionEvents.eventType,
      occurredAtMs: sessionEvents.occurredAtMs,
      agentRunId: eventRuns.agentRunId,
      providerKey: agentRuns.providerKey,
      messageRole: messages.role,
      messageKind: messages.messageKind,
      messageStatus: messages.status,
      runState: agentRunStateUpdates.state,
      runStateDetail: agentRunStateUpdates.detail,
      presentationMode: agentRunPresentations.mode,
      presentationInitialState: agentRunPresentations.initialState,
      presentationSummaryMessageEventId:
        agentRunPresentations.summaryMessageEventId,
      presentationLabel: agentRunPresentations.label,
      reasoningKind: reasoningSummaries.summaryKind,
      reasoningText: reasoningSummaries.summaryText,
      taskPlanId: taskPlanEvents.planId,
      taskPlanTitle: taskPlans.title,
      taskPlanSupersedesPlanId: taskPlans.supersedesPlanId,
      taskStepId: taskStepUpdates.taskStepId,
      taskStepState: taskStepUpdates.state,
      taskStepDetail: taskStepUpdates.detail,
      toolCapability: toolCalls.capability,
      toolOperation: toolCalls.operation,
      toolInputSchemaId: toolCalls.inputSchemaId,
      toolInputSchemaVersion: toolCalls.inputSchemaVersion,
      toolInputJson: toolCalls.inputJson,
      toolProgressCallEventId: toolProgressEvents.toolCallEventId,
      toolProgressSchemaId: toolProgressEvents.progressSchemaId,
      toolProgressSchemaVersion: toolProgressEvents.progressSchemaVersion,
      toolProgressJson: toolProgressEvents.progressJson,
      toolCallEventId: toolResults.toolCallEventId,
      toolOutcome: toolResults.outcome,
      toolOutputSchemaId: toolResults.outputSchemaId,
      toolOutputSchemaVersion: toolResults.outputSchemaVersion,
      toolOutputJson: toolResults.outputJson,
      approvalToolCallEventId: approvalRequests.toolCallEventId,
      approvalReason: approvalRequests.reason,
      approvalExpiresAtMs: approvalRequests.expiresAtMs,
      approvalRequestEventId: approvalDecisions.approvalRequestEventId,
      approvalDecision: approvalDecisions.decision,
      approvalActorType: approvalDecisions.actorType,
      approvalNote: approvalDecisions.note,
      errorCode: errors.code,
      errorMessage: errors.message,
      errorRetryable: errors.retryable,
    })
    .from(sessionEvents)
    .leftJoin(eventRuns, eq(eventRuns.eventId, sessionEvents.id))
    .leftJoin(agentRuns, eq(agentRuns.createdByEventId, sessionEvents.id))
    .leftJoin(messages, eq(messages.eventId, sessionEvents.id))
    .leftJoin(
      agentRunStateUpdates,
      eq(agentRunStateUpdates.eventId, sessionEvents.id),
    )
    .leftJoin(
      agentRunPresentations,
      eq(agentRunPresentations.eventId, sessionEvents.id),
    )
    .leftJoin(
      reasoningSummaries,
      eq(reasoningSummaries.eventId, sessionEvents.id),
    )
    .leftJoin(taskPlanEvents, eq(taskPlanEvents.eventId, sessionEvents.id))
    .leftJoin(taskPlans, eq(taskPlans.id, taskPlanEvents.planId))
    .leftJoin(taskStepUpdates, eq(taskStepUpdates.eventId, sessionEvents.id))
    .leftJoin(toolCalls, eq(toolCalls.eventId, sessionEvents.id))
    .leftJoin(
      toolProgressEvents,
      eq(toolProgressEvents.eventId, sessionEvents.id),
    )
    .leftJoin(toolResults, eq(toolResults.eventId, sessionEvents.id))
    .leftJoin(approvalRequests, eq(approvalRequests.eventId, sessionEvents.id))
    .leftJoin(
      approvalDecisions,
      eq(approvalDecisions.eventId, sessionEvents.id),
    )
    .leftJoin(errors, eq(errors.eventId, sessionEvents.id))
    .where(eq(sessionEvents.sessionId, sessionId))
    .orderBy(asc(sessionEvents.sessionRevision));

  const messagePartsQuery = database.db
    .select({
      messageEventId: messageParts.messageEventId,
      position: messageParts.position,
      partType: messageParts.partType,
      textContent: messageParts.textContent,
      id: artifacts.id,
      name: artifacts.name,
      artifactType: artifacts.artifactType,
      fileMimeType: fileArtifacts.mimeType,
      fileAvailability: fileArtifacts.availability,
      linkUrl: linkArtifacts.url,
    })
    .from(messageParts)
    .innerJoin(sessionEvents, eq(sessionEvents.id, messageParts.messageEventId))
    .leftJoin(artifacts, eq(artifacts.id, messageParts.artifactId))
    .leftJoin(fileArtifacts, eq(fileArtifacts.artifactId, artifacts.id))
    .leftJoin(linkArtifacts, eq(linkArtifacts.artifactId, artifacts.id))
    .where(
      and(
        eq(sessionEvents.sessionId, sessionId),
        inArray(messageParts.partType, ["text", "artifact_reference"]),
        isNull(artifacts.deletedAtMs),
      ),
    )
    .orderBy(asc(messageParts.messageEventId), asc(messageParts.position));
  const [rows, transcriptParts] = await Promise.all([
    rowsQuery,
    messagePartsQuery,
  ]);
  const messageText = new Map<string, string[]>();
  const messageArtifacts = new Map<string, SessionTranscriptArtifactRecord[]>();
  for (const part of transcriptParts) {
    if (part.partType === "text" && part.textContent !== null) {
      const values = messageText.get(part.messageEventId) ?? [];
      values.push(part.textContent);
      messageText.set(part.messageEventId, values);
      continue;
    }
    if (
      part.partType === "artifact_reference" &&
      part.id &&
      part.name &&
      part.artifactType
    ) {
      const values = messageArtifacts.get(part.messageEventId) ?? [];
      values.push({
        id: part.id,
        name: part.name,
        artifactType: part.artifactType,
        storageKind: part.fileMimeType ? "file" : "link",
        mimeType: part.fileMimeType,
        availability: part.fileAvailability,
        url: part.linkUrl,
      });
      messageArtifacts.set(part.messageEventId, values);
    }
  }

  const planIds = Array.from(
    new Set(rows.flatMap((row) => (row.taskPlanId ? [row.taskPlanId] : []))),
  );
  const planStepRows =
    planIds.length === 0
      ? []
      : await database.db
          .select({
            planId: taskSteps.planId,
            id: taskSteps.id,
            position: taskSteps.position,
            title: taskSteps.title,
          })
          .from(taskSteps)
          .where(inArray(taskSteps.planId, planIds))
          .orderBy(asc(taskSteps.planId), asc(taskSteps.position));
  const planSteps = new Map<
    string,
    Array<{ id: string; position: number; title: string }>
  >();
  for (const step of planStepRows) {
    const steps = planSteps.get(step.planId) ?? [];
    steps.push({ id: step.id, position: step.position, title: step.title });
    planSteps.set(step.planId, steps);
  }

  return rows.flatMap<SessionTranscriptEventRecord>((row) => {
    const base = {
      eventId: row.eventId,
      sessionRevision: row.sessionRevision,
      occurredAt: toIso(row.occurredAtMs),
      agentRunId: row.agentRunId,
    };

    switch (row.eventType) {
      case "message":
        if (!row.messageRole || !row.messageKind || !row.messageStatus)
          throw new Error(`Message event ${row.eventId} is incomplete`);
        return [
          {
            ...base,
            eventType: row.eventType,
            role: row.messageRole,
            messageKind: row.messageKind,
            status: row.messageStatus,
            text: (messageText.get(row.eventId) ?? []).join("\n\n"),
            ...((messageArtifacts.get(row.eventId)?.length ?? 0) > 0
              ? { artifacts: messageArtifacts.get(row.eventId)! }
              : {}),
          },
        ];
      case "agent_run":
        if (!row.agentRunId || !row.providerKey)
          throw new Error(`Agent run event ${row.eventId} is incomplete`);
        return [
          {
            ...base,
            agentRunId: row.agentRunId,
            eventType: row.eventType,
            providerKey: row.providerKey,
          },
        ];
      case "agent_run_state_update":
        if (!row.agentRunId || !row.runState)
          throw new Error(`Agent run state event ${row.eventId} is incomplete`);
        return [
          {
            ...base,
            agentRunId: row.agentRunId,
            eventType: row.eventType,
            state: row.runState,
            detail: row.runStateDetail,
          },
        ];
      case "agent_run_presentation":
        if (!row.agentRunId || !row.presentationMode)
          throw new Error(
            `Agent run presentation event ${row.eventId} is incomplete`,
          );
        return [
          {
            ...base,
            agentRunId: row.agentRunId,
            eventType: row.eventType,
            mode: row.presentationMode,
            initialState: row.presentationInitialState,
            summaryMessageEventId: row.presentationSummaryMessageEventId,
            label: row.presentationLabel,
          },
        ];
      case "reasoning_summary":
        if (!row.reasoningKind || !row.reasoningText)
          throw new Error(`Reasoning event ${row.eventId} is incomplete`);
        return [
          {
            ...base,
            eventType: row.eventType,
            summaryKind: row.reasoningKind,
            summaryText: row.reasoningText,
          },
        ];
      case "task_plan":
        if (!row.taskPlanId || !row.taskPlanTitle)
          throw new Error(`Task plan event ${row.eventId} is incomplete`);
        return [
          {
            ...base,
            eventType: row.eventType,
            planId: row.taskPlanId,
            title: row.taskPlanTitle,
            supersedesPlanId: row.taskPlanSupersedesPlanId,
            steps: planSteps.get(row.taskPlanId) ?? [],
          },
        ];
      case "task_step_update":
        if (!row.taskStepId || !row.taskStepState)
          throw new Error(`Task step event ${row.eventId} is incomplete`);
        return [
          {
            ...base,
            eventType: row.eventType,
            taskStepId: row.taskStepId,
            state: row.taskStepState,
            detail: row.taskStepDetail,
          },
        ];
      case "tool_call":
        if (
          !row.toolCapability ||
          !row.toolOperation ||
          !row.toolInputSchemaId ||
          row.toolInputSchemaVersion === null ||
          !row.toolInputJson
        )
          throw new Error(`Tool call event ${row.eventId} is incomplete`);
        return [
          {
            ...base,
            eventType: row.eventType,
            capability: row.toolCapability,
            operation: row.toolOperation,
            inputSchemaId: row.toolInputSchemaId,
            inputSchemaVersion: row.toolInputSchemaVersion,
            input: JSON.parse(row.toolInputJson) as JsonValue,
          },
        ];
      case "tool_result":
        if (
          !row.toolCallEventId ||
          !row.toolOutcome ||
          !row.toolOutputSchemaId ||
          row.toolOutputSchemaVersion === null ||
          !row.toolOutputJson
        )
          throw new Error(`Tool result event ${row.eventId} is incomplete`);
        return [
          {
            ...base,
            eventType: row.eventType,
            toolCallEventId: row.toolCallEventId,
            outcome: row.toolOutcome,
            outputSchemaId: row.toolOutputSchemaId,
            outputSchemaVersion: row.toolOutputSchemaVersion,
            output: JSON.parse(row.toolOutputJson) as JsonValue,
          },
        ];
      case "tool_progress":
        if (
          !row.toolProgressCallEventId ||
          !row.toolProgressSchemaId ||
          row.toolProgressSchemaVersion === null ||
          !row.toolProgressJson
        ) {
          throw new Error(`Tool progress event ${row.eventId} is incomplete`);
        }
        return [
          {
            ...base,
            eventType: row.eventType,
            toolCallEventId: row.toolProgressCallEventId,
            progressSchemaId: row.toolProgressSchemaId,
            progressSchemaVersion: row.toolProgressSchemaVersion,
            progress: JSON.parse(row.toolProgressJson) as JsonValue,
          },
        ];
      case "approval_request":
        if (!row.approvalToolCallEventId || !row.approvalReason) {
          throw new Error(
            `Approval request event ${row.eventId} is incomplete`,
          );
        }
        return [
          {
            ...base,
            eventType: row.eventType,
            toolCallEventId: row.approvalToolCallEventId,
            reason: row.approvalReason,
            expiresAt: row.approvalExpiresAtMs
              ? toIso(row.approvalExpiresAtMs)
              : null,
          },
        ];
      case "approval_decision":
        if (
          !row.approvalRequestEventId ||
          !row.approvalDecision ||
          !row.approvalActorType
        ) {
          throw new Error(
            `Approval decision event ${row.eventId} is incomplete`,
          );
        }
        return [
          {
            ...base,
            eventType: row.eventType,
            approvalRequestEventId: row.approvalRequestEventId,
            decision: row.approvalDecision,
            actorType: row.approvalActorType,
            note: row.approvalNote,
          },
        ];
      case "error":
        if (!row.errorCode || !row.errorMessage || row.errorRetryable === null)
          throw new Error(`Error event ${row.eventId} is incomplete`);
        return [
          {
            ...base,
            eventType: row.eventType,
            code: row.errorCode,
            message: row.errorMessage,
            retryable: row.errorRetryable,
          },
        ];
      default:
        return [];
    }
  });
}

export async function getSessionProjectContext(
  database: RadiusDatabase,
  sessionId: string,
): Promise<SessionProjectContext | null> {
  const [session] = await database.db
    .select({ projectId: sessions.projectId })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), isNull(sessions.deletedAtMs)))
    .limit(1);
  return session ?? null;
}

export async function setSessionPinned(
  database: RadiusDatabase,
  input: SetSessionPinnedInput,
): Promise<string | null> {
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new Error("Pin timestamp must be a positive integer");
  }

  return database.db.transaction(async (tx) => {
    const [localClient] = await tx
      .select({ id: clientInstances.id })
      .from(clientInstances)
      .where(
        and(
          eq(clientInstances.id, input.clientInstanceId),
          eq(clientInstances.isLocal, true),
        ),
      )
      .limit(1);
    if (!localClient) throw new Error("Pins must belong to the local client");

    if (!input.pinned) {
      await tx
        .delete(sessionPins)
        .where(
          and(
            eq(sessionPins.clientInstanceId, input.clientInstanceId),
            eq(sessionPins.sessionId, input.sessionId),
          ),
        );
      return null;
    }

    const [session] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, input.sessionId),
          isNull(sessions.archivedAtMs),
          isNull(sessions.deletedAtMs),
        ),
      )
      .limit(1);
    if (!session) throw new Error("Only an active session can be pinned");

    await tx
      .insert(sessionPins)
      .values({
        clientInstanceId: input.clientInstanceId,
        sessionId: input.sessionId,
        pinnedAtMs: now,
      })
      .onConflictDoUpdate({
        target: [sessionPins.clientInstanceId, sessionPins.sessionId],
        set: { pinnedAtMs: now },
      });
    return toIso(now);
  });
}

export async function updateSessionTitle(
  database: RadiusDatabase,
  input: UpdateSessionTitleInput,
): Promise<SessionRecord> {
  const now = input.now ?? Date.now();
  const title = input.title.trim();
  if (!title) throw new Error("Session title is required");

  return database.db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.id, input.sessionId),
          eq(sessions.originClientInstanceId, input.originClientInstanceId),
          isNull(sessions.archivedAtMs),
          isNull(sessions.deletedAtMs),
        ),
      )
      .limit(1);
    if (!current) {
      throw new Error("Only the local origin can rename an active session");
    }

    const titleChanged = current.title !== title;
    const session = SessionRecordSchema.parse({
      id: current.id,
      originClientInstanceId: current.originClientInstanceId,
      projectId: current.projectId,
      title,
      status: current.status,
      revision: current.revision + (titleChanged ? 1 : 0),
      createdAt: toIso(current.createdAtMs),
      updatedAt: toIso(titleChanged ? now : current.updatedAtMs),
      archivedAt: null,
      deletedAt: null,
    });
    if (!titleChanged) return session;
    const { envelope, payloadJson } = prepareLocalChange({
      originClientInstanceId: session.originClientInstanceId,
      sessionId: session.id,
      sessionRevision: session.revision,
      createdAt: session.updatedAt,
      kind: "session.upsert",
      payload: session,
    });

    const updated = await tx
      .update(sessions)
      .set({
        title: session.title,
        revision: session.revision,
        updatedAtMs: now,
      })
      .where(
        and(
          eq(sessions.id, current.id),
          eq(sessions.revision, current.revision),
        ),
      )
      .returning({ id: sessions.id });
    if (updated.length !== 1) {
      throw new Error("Session revision changed concurrently");
    }

    await insertLocalChange(tx, envelope, payloadJson);
    return session;
  });
}

export async function setSessionArchived(
  database: RadiusDatabase,
  input: SetSessionArchivedInput,
): Promise<SessionRecord> {
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new Error("Archive timestamp must be a positive integer");
  }

  return database.db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.id, input.sessionId),
          eq(sessions.originClientInstanceId, input.originClientInstanceId),
          isNull(sessions.archivedAtMs),
          isNull(sessions.deletedAtMs),
        ),
      )
      .limit(1);
    if (!current) {
      throw new Error("Only the local origin can archive an active session");
    }

    const session = SessionRecordSchema.parse({
      id: current.id,
      originClientInstanceId: current.originClientInstanceId,
      projectId: current.projectId,
      title: current.title,
      status: current.status,
      revision: current.revision + 1,
      createdAt: toIso(current.createdAtMs),
      updatedAt: toIso(now),
      archivedAt: toIso(now),
      deletedAt: null,
    });
    const { envelope, payloadJson } = prepareLocalChange({
      originClientInstanceId: session.originClientInstanceId,
      sessionId: session.id,
      sessionRevision: session.revision,
      createdAt: session.updatedAt,
      kind: "session.upsert",
      payload: session,
    });

    const updated = await tx
      .update(sessions)
      .set({
        revision: session.revision,
        updatedAtMs: now,
        archivedAtMs: now,
      })
      .where(
        and(
          eq(sessions.id, current.id),
          eq(sessions.revision, current.revision),
        ),
      )
      .returning({ id: sessions.id });
    if (updated.length !== 1) {
      throw new Error("Session revision changed concurrently");
    }

    await tx.delete(sessionPins).where(eq(sessionPins.sessionId, session.id));
    await tx
      .delete(composerDrafts)
      .where(eq(composerDrafts.sessionId, session.id));
    await insertLocalChange(tx, envelope, payloadJson);
    return session;
  });
}

export async function createSession(
  database: RadiusDatabase,
  input: CreateSessionInput,
): Promise<SessionRecord> {
  const now = input.now ?? Date.now();
  const session = SessionRecordSchema.parse({
    id: randomUUID(),
    originClientInstanceId: input.originClientInstanceId,
    projectId: input.projectId ?? null,
    title: input.title,
    status: input.status ?? "active",
    revision: 1,
    createdAt: toIso(now),
    updatedAt: toIso(now),
    archivedAt: null,
    deletedAt: null,
  });
  const { envelope, payloadJson } = prepareLocalChange({
    originClientInstanceId: session.originClientInstanceId,
    sessionId: session.id,
    sessionRevision: session.revision,
    createdAt: session.createdAt,
    kind: "session.upsert",
    payload: session,
  });

  await database.db.transaction(async (tx) => {
    const [origin] = await tx
      .select({ id: clientInstances.id })
      .from(clientInstances)
      .where(
        and(
          eq(clientInstances.id, session.originClientInstanceId),
          eq(clientInstances.isLocal, true),
        ),
      );
    if (!origin)
      throw new Error("Session origin must be the local client instance");
    if (session.projectId) {
      const [project] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(eq(projects.id, session.projectId), isNull(projects.deletedAtMs)),
        )
        .limit(1);
      if (!project) {
        throw new Error("Session project must exist");
      }
    }
    await tx.insert(sessions).values({
      id: session.id,
      originClientInstanceId: session.originClientInstanceId,
      projectId: session.projectId,
      title: session.title,
      status: session.status,
      revision: session.revision,
      createdAtMs: now,
      updatedAtMs: now,
    });
    await insertLocalChange(tx, envelope, payloadJson);
  });

  return session;
}

export async function appendSessionEvent(
  database: RadiusDatabase,
  eventInput: SessionEventRecord,
  options: AppendEventOptions = {},
): Promise<SessionEventRecord> {
  const event = SessionEventRecordSchema.parse(eventInput);
  const syncEvent = sessionEventForSync(event);
  const { envelope, payloadJson } = prepareLocalChange({
    originClientInstanceId: event.sourceClientInstanceId,
    sessionId: event.sessionId,
    sessionRevision: event.sessionRevision,
    createdAt: event.occurredAt,
    kind: "session.event.append",
    payload: syncEvent,
  });

  await database.db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, event.sessionId))
      .limit(1);
    if (!session) throw new Error("Session does not exist");
    if (session.originClientInstanceId !== event.sourceClientInstanceId) {
      throw new Error(
        "Only the origin client instance may append session events",
      );
    }
    if (event.sessionRevision !== session.revision + 1) {
      throw new Error(
        `Expected session revision ${session.revision + 1}, received ${event.sessionRevision}`,
      );
    }

    await tx.insert(sessionEvents).values({
      id: event.eventId,
      sessionId: event.sessionId,
      sessionRevision: event.sessionRevision,
      eventType: event.eventType,
      sourceClientInstanceId: event.sourceClientInstanceId,
      occurredAtMs: Date.parse(event.occurredAt),
    });
    await insertArtifacts(tx, event, options.fileLocations ?? {});
    await insertEventSubtype(tx, event, {
      fileVersionLocations: options.fileVersionLocations ?? {},
      requireLocalFiles: true,
      sessionProjectId: session.projectId,
    });
    await associateEventWithRun(tx, event);

    const updated = await tx
      .update(sessions)
      .set({
        revision: event.sessionRevision,
        updatedAtMs: Date.parse(event.occurredAt),
      })
      .where(
        and(
          eq(sessions.id, event.sessionId),
          eq(sessions.revision, session.revision),
        ),
      )
      .returning({ id: sessions.id });
    if (updated.length !== 1)
      throw new Error("Session revision changed concurrently");

    await insertLocalChange(tx, envelope, payloadJson);
  });

  return event;
}

function sessionEventForSync(event: SessionEventRecord): SessionEventRecord {
  if (event.eventType === "tool_call") {
    return {
      ...event,
      input: { redacted: "Tool input remains on the originating device" },
    };
  }
  if (event.eventType === "tool_result") {
    return {
      ...event,
      output: { redacted: "Tool output remains on the originating device" },
    };
  }
  if (event.eventType !== "tool_progress") return event;

  const progress =
    event.progress !== null &&
    !Array.isArray(event.progress) &&
    typeof event.progress === "object"
      ? event.progress
      : {};
  return {
    ...event,
    progress: Object.fromEntries(
      ["kind", "status", "title"].flatMap((key) =>
        typeof progress[key] === "string" ? [[key, progress[key]]] : [],
      ),
    ),
  };
}

function localChangeEnvelope(
  row: typeof localChanges.$inferSelect,
): SyncChangeEnvelope {
  const projectChange =
    row.kind === "project.upsert" || row.kind === "project.delete";
  return SyncChangeEnvelopeSchema.parse({
    protocolVersion: 1,
    changeId: row.id,
    originClientInstanceId: row.originClientInstanceId,
    ...(projectChange
      ? { projectId: row.projectId, projectRevision: row.projectRevision }
      : { sessionId: row.sessionId, sessionRevision: row.sessionRevision }),
    payloadSchemaVersion: row.payloadSchemaVersion,
    payloadSha256: row.payloadSha256,
    createdAt: toIso(row.createdAtMs),
    kind: row.kind,
    payload: JSON.parse(row.payloadJson),
  });
}

export async function configureSyncConnection(
  database: RadiusDatabase,
  input: Omit<SyncConnectionRecord, "createdAtMs" | "updatedAtMs"> & {
    now?: number;
  },
): Promise<SyncConnectionRecord> {
  const now = input.now ?? Date.now();
  await database.db
    .insert(syncConnections)
    .values({
      id: input.id,
      providerKey: input.providerKey,
      endpointUrl: input.endpointUrl,
      credentialRef: input.credentialRef,
      remoteSubject: input.remoteSubject,
      accountLabel: input.accountLabel,
      enabled: false,
      createdAtMs: now,
      updatedAtMs: now,
    })
    .onConflictDoUpdate({
      target: syncConnections.id,
      set: {
        providerKey: input.providerKey,
        endpointUrl: input.endpointUrl,
        credentialRef: input.credentialRef,
        remoteSubject: input.remoteSubject,
        accountLabel: input.accountLabel,
        updatedAtMs: now,
      },
    });
  if (input.enabled) await enableSyncConnection(database, input.id, now);
  const [connection] = await database.db
    .select()
    .from(syncConnections)
    .where(eq(syncConnections.id, input.id));
  if (!connection) throw new Error("Sync connection was not persisted");
  return connection;
}

export async function getEnabledSyncConnection(
  database: RadiusDatabase,
): Promise<SyncConnectionRecord | null> {
  const connections = await database.db
    .select()
    .from(syncConnections)
    .where(eq(syncConnections.enabled, true))
    .limit(2);
  if (connections.length > 1) {
    throw new Error(
      "Radius storage contains more than one enabled sync connection",
    );
  }
  return connections[0] ?? null;
}

export async function getMostRecentSyncConnection(
  database: RadiusDatabase,
): Promise<SyncConnectionRecord | null> {
  const [connection] = await database.db
    .select()
    .from(syncConnections)
    .orderBy(sql`${syncConnections.updatedAtMs} desc`)
    .limit(1);
  return connection ?? null;
}

export async function disableSyncConnections(
  database: RadiusDatabase,
  now = Date.now(),
): Promise<void> {
  await database.db
    .update(syncConnections)
    .set({ enabled: false, updatedAtMs: now })
    .where(eq(syncConnections.enabled, true));
}

export async function enableSyncConnection(
  database: RadiusDatabase,
  connectionId: string,
  now = Date.now(),
): Promise<void> {
  await database.db.transaction(async (tx) => {
    const [connection] = await tx
      .select({ id: syncConnections.id })
      .from(syncConnections)
      .where(eq(syncConnections.id, connectionId));
    if (!connection) throw new Error("Sync connection does not exist");

    await tx
      .update(syncConnections)
      .set({ enabled: false, updatedAtMs: now })
      .where(eq(syncConnections.enabled, true));
    await tx
      .update(syncConnections)
      .set({ enabled: true, updatedAtMs: now })
      .where(eq(syncConnections.id, connectionId));

    await tx.run(sql`
      insert or ignore into sync_deliveries (connection_id, change_id)
      select ${connectionId}, id from local_changes
    `);
    await tx.run(sql`
      insert or ignore into artifact_transfers (connection_id, artifact_id)
      select ${connectionId}, artifact_id
      from file_artifacts
      where availability = 'local'
    `);
    await tx
      .insert(syncCursors)
      .values({ connectionId, stream: "main" })
      .onConflictDoNothing();
  });
}

export async function resetInFlightDeliveries(
  database: RadiusDatabase,
  connectionId: string,
): Promise<void> {
  await database.db
    .update(syncDeliveries)
    .set({ state: "pending" })
    .where(
      and(
        eq(syncDeliveries.connectionId, connectionId),
        eq(syncDeliveries.state, "in_flight"),
      ),
    );
}

export async function resetInFlightArtifactTransfers(
  database: RadiusDatabase,
  connectionId: string,
): Promise<void> {
  await database.db
    .update(artifactTransfers)
    .set({ state: "pending" })
    .where(
      and(
        eq(artifactTransfers.connectionId, connectionId),
        eq(artifactTransfers.state, "uploading"),
      ),
    );
}

export async function claimPendingDeliveries(
  database: RadiusDatabase,
  connectionId: string,
  limit: number,
  now = Date.now(),
): Promise<ClaimedDelivery[]> {
  return database.db.transaction(async (tx) => {
    const rows = await tx
      .select({ change: localChanges, delivery: syncDeliveries })
      .from(syncDeliveries)
      .innerJoin(localChanges, eq(syncDeliveries.changeId, localChanges.id))
      .where(
        and(
          eq(syncDeliveries.connectionId, connectionId),
          eq(syncDeliveries.state, "pending"),
          or(
            isNull(syncDeliveries.nextAttemptAtMs),
            lte(syncDeliveries.nextAttemptAtMs, now),
          ),
        ),
      )
      .orderBy(
        asc(localChanges.createdAtMs),
        asc(
          sql`coalesce(${localChanges.projectRevision}, ${localChanges.sessionRevision})`,
        ),
      )
      .limit(limit);
    if (rows.length === 0) return [];

    for (const row of rows) {
      await tx
        .update(syncDeliveries)
        .set({
          state: "in_flight",
          attemptCount: row.delivery.attemptCount + 1,
        })
        .where(
          and(
            eq(syncDeliveries.connectionId, connectionId),
            eq(syncDeliveries.changeId, row.change.id),
          ),
        );
    }

    return rows.map((row) => ({
      attemptCount: row.delivery.attemptCount + 1,
      change: localChangeEnvelope(row.change),
    }));
  });
}

export async function recordPushResults(
  database: RadiusDatabase,
  connectionId: string,
  results: readonly PushChangeResult[],
  now = Date.now(),
): Promise<void> {
  await database.db.transaction(async (tx) => {
    for (const result of results) {
      const acknowledged =
        result.status === "accepted" || result.status === "duplicate";
      await tx
        .update(syncDeliveries)
        .set({
          state: acknowledged ? "acked" : "rejected",
          ackedAtMs: acknowledged ? now : null,
          nextAttemptAtMs: null,
          lastErrorCode: result.errorCode,
        })
        .where(
          and(
            eq(syncDeliveries.connectionId, connectionId),
            eq(syncDeliveries.changeId, result.changeId),
          ),
        );
    }
  });
}

export async function recordTransientFailure(
  database: RadiusDatabase,
  connectionId: string,
  deliveries: readonly ClaimedDelivery[],
  errorCode: string,
  now = Date.now(),
): Promise<void> {
  await database.db.transaction(async (tx) => {
    for (const delivery of deliveries) {
      const delay = retryDelayMs(delivery.attemptCount);
      await tx
        .update(syncDeliveries)
        .set({
          state: "pending",
          nextAttemptAtMs: now + delay,
          lastErrorCode: errorCode,
        })
        .where(
          and(
            eq(syncDeliveries.connectionId, connectionId),
            eq(syncDeliveries.changeId, delivery.change.changeId),
          ),
        );
    }
  });
}

export async function claimPendingArtifactTransfers(
  database: RadiusDatabase,
  connectionId: string,
  limit: number,
  now = Date.now(),
): Promise<ClaimedArtifactTransfer[]> {
  return database.db.transaction(async (tx) => {
    const rows = await tx
      .select({ transfer: artifactTransfers, file: fileArtifacts })
      .from(artifactTransfers)
      .innerJoin(
        fileArtifacts,
        eq(artifactTransfers.artifactId, fileArtifacts.artifactId),
      )
      .where(
        and(
          eq(artifactTransfers.connectionId, connectionId),
          eq(artifactTransfers.state, "pending"),
          eq(fileArtifacts.availability, "local"),
          or(
            isNull(artifactTransfers.nextAttemptAtMs),
            lte(artifactTransfers.nextAttemptAtMs, now),
          ),
        ),
      )
      .limit(limit);

    for (const row of rows) {
      await tx
        .update(artifactTransfers)
        .set({
          state: "uploading",
          attemptCount: row.transfer.attemptCount + 1,
        })
        .where(
          and(
            eq(artifactTransfers.connectionId, connectionId),
            eq(artifactTransfers.artifactId, row.transfer.artifactId),
          ),
        );
    }

    return rows.map((row) => ({
      artifactId: row.transfer.artifactId,
      mimeType: row.file.mimeType,
      contentSha256: row.file.contentSha256,
      byteSize: row.file.byteSize,
      localRelativePath: row.file.localRelativePath!,
      attemptCount: row.transfer.attemptCount + 1,
    }));
  });
}

export async function recordArtifactTransferSuccess(
  database: RadiusDatabase,
  connectionId: string,
  artifactId: string,
  remoteLocator: string,
  now = Date.now(),
): Promise<void> {
  await database.db
    .update(artifactTransfers)
    .set({
      state: "available",
      remoteLocator,
      completedAtMs: now,
      nextAttemptAtMs: null,
      lastErrorCode: null,
    })
    .where(
      and(
        eq(artifactTransfers.connectionId, connectionId),
        eq(artifactTransfers.artifactId, artifactId),
      ),
    );
}

export async function recordArtifactTransferFailure(
  database: RadiusDatabase,
  connectionId: string,
  transfer: ClaimedArtifactTransfer,
  errorCode: string,
  now = Date.now(),
): Promise<void> {
  const delay = retryDelayMs(transfer.attemptCount);
  await database.db
    .update(artifactTransfers)
    .set({
      state: "pending",
      nextAttemptAtMs: now + delay,
      lastErrorCode: errorCode,
    })
    .where(
      and(
        eq(artifactTransfers.connectionId, connectionId),
        eq(artifactTransfers.artifactId, transfer.artifactId),
      ),
    );
}

export async function getPullCursor(
  database: RadiusDatabase,
  connectionId: string,
): Promise<string | null> {
  const [cursor] = await database.db
    .select({ value: syncCursors.pullCursor })
    .from(syncCursors)
    .where(
      and(
        eq(syncCursors.connectionId, connectionId),
        eq(syncCursors.stream, "main"),
      ),
    );
  return cursor?.value ?? null;
}

export async function savePullCursor(
  database: RadiusDatabase,
  connectionId: string,
  cursor: string | null,
  now = Date.now(),
): Promise<void> {
  await database.db
    .insert(syncCursors)
    .values({
      connectionId,
      stream: "main",
      pullCursor: cursor,
      lastPullAtMs: now,
      lastSuccessAtMs: now,
    })
    .onConflictDoUpdate({
      target: [syncCursors.connectionId, syncCursors.stream],
      set: { pullCursor: cursor, lastPullAtMs: now, lastSuccessAtMs: now },
    });
}

export async function applyRemoteChange(
  database: RadiusDatabase,
  connectionId: string,
  changeInput: SyncChangeEnvelope,
  now = Date.now(),
): Promise<"applied" | "duplicate"> {
  const change = SyncChangeEnvelopeSchema.parse(changeInput);
  const payloadJson = canonicalJson(asJsonValue(change.payload));
  if (sha256Hex(payloadJson) !== change.payloadSha256) {
    throw new Error("Remote change payload hash mismatch");
  }

  return database.db.transaction(async (tx) => {
    const [receipt] = await tx
      .select()
      .from(syncInbox)
      .where(
        and(
          eq(syncInbox.connectionId, connectionId),
          eq(syncInbox.remoteChangeId, change.changeId),
        ),
      );
    if (receipt) {
      if (receipt.payloadSha256 !== change.payloadSha256) {
        throw new Error(
          "Remote change identifier was reused with different content",
        );
      }
      return "duplicate" as const;
    }

    if (change.kind === "project.upsert" || change.kind === "project.delete") {
      const [currentProject] = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, change.projectId));
      if (currentProject) {
        assertRemoteOrigin(
          "project",
          currentProject.originClientInstanceId,
          change.originClientInstanceId,
        );
      }
      if (currentProject && currentProject.revision >= change.projectRevision) {
        await tx.insert(syncInbox).values({
          connectionId,
          remoteChangeId: change.changeId,
          payloadSha256: change.payloadSha256,
          receivedAtMs: now,
          appliedAtMs: now,
        });
        return "duplicate" as const;
      }
      if (change.projectRevision !== (currentProject?.revision ?? 0) + 1) {
        throw new Error("Remote project revision is not sequential");
      }

      const project = change.payload;
      await tx
        .insert(clientInstances)
        .values({
          id: project.originClientInstanceId,
          displayName: "Remote client",
          platform: "remote",
          publicKeyJwk: "{}",
          isLocal: false,
          createdAtMs: now,
          updatedAtMs: now,
        })
        .onConflictDoNothing();

      if (!currentProject) {
        if (change.kind === "project.delete") {
          throw new Error("Remote delete references a missing project");
        }
        await tx.insert(projects).values({
          id: project.id,
          originClientInstanceId: project.originClientInstanceId,
          name: project.name,
          revision: project.revision,
          createdAtMs: Date.parse(project.createdAt),
          updatedAtMs: Date.parse(project.updatedAt),
          archivedAtMs: project.archivedAt
            ? Date.parse(project.archivedAt)
            : null,
          deletedAtMs: project.deletedAt ? Date.parse(project.deletedAt) : null,
        });
      } else {
        await tx
          .update(projects)
          .set({
            name: project.name,
            revision: project.revision,
            updatedAtMs: Date.parse(project.updatedAt),
            archivedAtMs: project.archivedAt
              ? Date.parse(project.archivedAt)
              : null,
            deletedAtMs: project.deletedAt
              ? Date.parse(project.deletedAt)
              : null,
          })
          .where(eq(projects.id, project.id));
      }

      await tx.insert(syncInbox).values({
        connectionId,
        remoteChangeId: change.changeId,
        payloadSha256: change.payloadSha256,
        receivedAtMs: now,
        appliedAtMs: now,
      });
      return "applied" as const;
    }

    const [current] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, change.sessionId));
    if (current) {
      assertRemoteOrigin(
        "session",
        current.originClientInstanceId,
        change.originClientInstanceId,
      );
    }
    if (current && current.revision >= change.sessionRevision) {
      await tx.insert(syncInbox).values({
        connectionId,
        remoteChangeId: change.changeId,
        payloadSha256: change.payloadSha256,
        receivedAtMs: now,
        appliedAtMs: now,
      });
      return "duplicate" as const;
    }
    if (change.sessionRevision !== (current?.revision ?? 0) + 1) {
      throw new Error("Remote session revision is not sequential");
    }

    if (change.kind === "session.upsert") {
      const session = change.payload;
      if (session.projectId) {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, session.projectId),
              isNull(projects.deletedAtMs),
            ),
          )
          .limit(1);
        if (!project) {
          throw new Error("Remote session references a missing project");
        }
      }
      if (!current) {
        await tx
          .insert(clientInstances)
          .values({
            id: session.originClientInstanceId,
            displayName: "Remote client",
            platform: "remote",
            publicKeyJwk: "{}",
            isLocal: false,
            createdAtMs: now,
            updatedAtMs: now,
          })
          .onConflictDoNothing();
        await tx.insert(sessions).values({
          id: session.id,
          originClientInstanceId: session.originClientInstanceId,
          projectId: session.projectId,
          title: session.title,
          status: session.status,
          revision: session.revision,
          createdAtMs: Date.parse(session.createdAt),
          updatedAtMs: Date.parse(session.updatedAt),
          archivedAtMs: session.archivedAt
            ? Date.parse(session.archivedAt)
            : null,
          deletedAtMs: session.deletedAt ? Date.parse(session.deletedAt) : null,
        });
      } else {
        await tx
          .update(sessions)
          .set({
            projectId: session.projectId,
            title: session.title,
            status: session.status,
            revision: session.revision,
            updatedAtMs: Date.parse(session.updatedAt),
            archivedAtMs: session.archivedAt
              ? Date.parse(session.archivedAt)
              : null,
            deletedAtMs: session.deletedAt
              ? Date.parse(session.deletedAt)
              : null,
          })
          .where(eq(sessions.id, session.id));
      }
    } else if (change.kind === "session.event.append") {
      if (!current)
        throw new Error("Remote event references a missing session");
      const event = change.payload;
      await tx.insert(sessionEvents).values({
        id: event.eventId,
        sessionId: event.sessionId,
        sessionRevision: event.sessionRevision,
        eventType: event.eventType,
        sourceClientInstanceId: event.sourceClientInstanceId,
        occurredAtMs: Date.parse(event.occurredAt),
      });
      await insertArtifacts(tx, event, {}, false);
      await insertEventSubtype(tx, event, {
        fileVersionLocations: {},
        requireLocalFiles: false,
        sessionProjectId: current.projectId,
      });
      await associateEventWithRun(tx, event);
      await tx
        .update(sessions)
        .set({
          revision: event.sessionRevision,
          updatedAtMs: Date.parse(event.occurredAt),
        })
        .where(eq(sessions.id, event.sessionId));
    } else {
      if (!current)
        throw new Error("Remote delete references a missing session");
      const session = change.payload;
      await tx
        .update(sessions)
        .set({
          projectId: session.projectId,
          title: session.title,
          status: session.status,
          revision: session.revision,
          updatedAtMs: Date.parse(session.updatedAt),
          archivedAtMs: session.archivedAt
            ? Date.parse(session.archivedAt)
            : null,
          deletedAtMs: session.deletedAt ? Date.parse(session.deletedAt) : null,
        })
        .where(eq(sessions.id, session.id));
    }

    await tx.insert(syncInbox).values({
      connectionId,
      remoteChangeId: change.changeId,
      payloadSha256: change.payloadSha256,
      receivedAtMs: now,
      appliedAtMs: now,
    });
    return "applied" as const;
  });
}
