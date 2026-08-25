import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { devices, platformAccounts } from "./platform.js";

const sync = pgSchema("sync");

export const workspaceProjects = sync.table(
  "workspace_projects",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "restrict" }),
    originDeviceId: uuid("origin_device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("sync_workspace_projects_account_id_uq").on(table.accountId, table.id),
    index("sync_workspace_projects_account_updated_idx").on(table.accountId, table.updatedAt),
    check("sync_workspace_projects_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const syncedSessions = sync.table(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "restrict" }),
    originDeviceId: uuid("origin_device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "restrict" }),
    workspaceProjectId: uuid("workspace_project_id").references(() => workspaceProjects.id, {
      onDelete: "restrict",
    }),
    title: text("title"),
    status: text("status").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("sync_sessions_account_id_uq").on(table.accountId, table.id),
    index("sync_sessions_account_project_updated_idx").on(
      table.accountId,
      table.workspaceProjectId,
      table.updatedAt,
    ),
    check("sync_sessions_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const sessionEvents = sync.table(
  "session_events",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => syncedSessions.id, { onDelete: "restrict" }),
    sessionRevision: bigint("session_revision", { mode: "number" }).notNull(),
    eventType: text("event_type").notNull(),
    agentRunId: uuid("agent_run_id"),
    sourceDeviceId: uuid("source_device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "restrict" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("sync_events_account_id_uq").on(table.accountId, table.id),
    unique("sync_events_session_revision_uq").on(table.accountId, table.sessionId, table.sessionRevision),
    index("sync_events_account_run_occurred_idx").on(table.accountId, table.agentRunId, table.occurredAt),
  ],
);

export const messages = sync.table("messages", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => sessionEvents.id, { onDelete: "restrict" }),
  accountId: uuid("account_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  role: text("role").notNull(),
  messageKind: text("message_kind").notNull(),
  status: text("status").notNull(),
  model: text("model"),
  providerMessageId: text("provider_message_id"),
  finishReason: text("finish_reason"),
});

export const messageParts = sync.table(
  "message_parts",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "restrict" }),
    messageEventId: uuid("message_event_id")
      .notNull()
      .references(() => messages.eventId, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    partType: text("part_type").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.messageEventId, table.position] }),
    check("sync_message_parts_position_nonnegative_ck", sql`${table.position} >= 0`),
  ],
);

export const agentRuns = sync.table(
  "agent_runs",
  {
    id: uuid("id").primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .unique()
      .references(() => sessionEvents.id, { onDelete: "restrict" }),
    accountId: uuid("account_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    providerKey: text("provider_key").notNull(),
    providerRunId: text("provider_run_id"),
    triggeringMessageEventId: uuid("triggering_message_event_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("sync_agent_runs_account_session_started_idx").on(table.accountId, table.sessionId, table.startedAt),
    unique("sync_agent_runs_account_provider_run_uq").on(table.accountId, table.providerKey, table.providerRunId),
  ],
);

export const agentRunStateUpdates = sync.table(
  "agent_run_state_updates",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => sessionEvents.id, { onDelete: "restrict" }),
    accountId: uuid("account_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    agentRunId: uuid("agent_run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "restrict" }),
    state: text("state").notNull(),
    detail: text("detail"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("sync_run_state_run_occurred_idx").on(table.agentRunId, table.occurredAt)],
);

export const agentRunPresentations = sync.table(
  "agent_run_presentations",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => sessionEvents.id, { onDelete: "restrict" }),
    accountId: uuid("account_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    agentRunId: uuid("agent_run_id")
      .notNull()
      .unique()
      .references(() => agentRuns.id, { onDelete: "restrict" }),
    mode: text("mode").notNull(),
    initialState: text("initial_state"),
    summaryMessageEventId: uuid("summary_message_event_id"),
    label: text("label"),
  },
  (table) => [
    check(
      "sync_agent_run_presentations_mode_ck",
      sql`${table.mode} in ('inline', 'collapsible')`,
    ),
    check(
      "sync_agent_run_presentations_state_matches_mode_ck",
      sql`(
        (${table.mode} = 'inline' and ${table.initialState} is null)
        or
        (${table.mode} = 'collapsible' and ${table.initialState} in ('expanded', 'collapsed'))
      )`,
    ),
    check(
      "sync_agent_run_presentations_label_ck",
      sql`${table.label} is null or (length(trim(${table.label})) > 0 and length(${table.label}) <= 80)`,
    ),
  ],
);

export const reasoningSummaries = sync.table("reasoning_summaries", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => sessionEvents.id, { onDelete: "restrict" }),
  accountId: uuid("account_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  summaryKind: text("summary_kind").notNull(),
  summaryText: text("summary_text").notNull(),
});

export const taskPlans = sync.table(
  "task_plans",
  {
    id: uuid("id").primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .unique()
      .references(() => sessionEvents.id, { onDelete: "restrict" }),
    accountId: uuid("account_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    title: text("title").notNull(),
    supersedesPlanId: uuid("supersedes_plan_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("sync_task_plans_session_created_idx").on(table.sessionId, table.createdAt)],
);

export const taskSteps = sync.table(
  "task_steps",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "restrict" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => taskPlans.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
  },
  (table) => [
    unique("sync_task_steps_plan_position_uq").on(table.planId, table.position),
    check("sync_task_steps_position_nonnegative_ck", sql`${table.position} >= 0`),
  ],
);

export const taskStepUpdates = sync.table("task_step_updates", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => sessionEvents.id, { onDelete: "restrict" }),
  accountId: uuid("account_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  taskStepId: uuid("task_step_id")
    .notNull()
    .references(() => taskSteps.id, { onDelete: "restrict" }),
  state: text("state").notNull(),
  detail: text("detail"),
});

export const toolCalls = sync.table("tool_calls", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => sessionEvents.id, { onDelete: "restrict" }),
  accountId: uuid("account_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  triggeringMessageEventId: uuid("triggering_message_event_id"),
  capability: text("capability").notNull(),
  operation: text("operation").notNull(),
  inputSchemaId: text("input_schema_id").notNull(),
  inputSchemaVersion: integer("input_schema_version").notNull(),
  input: jsonb("input").$type<unknown>().notNull(),
});

export const toolProgressEvents = sync.table(
  "tool_progress_events",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => sessionEvents.id, { onDelete: "restrict" }),
    accountId: uuid("account_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    toolCallEventId: uuid("tool_call_event_id")
      .notNull()
      .references(() => toolCalls.eventId, { onDelete: "restrict" }),
    progressSchemaId: text("progress_schema_id").notNull(),
    progressSchemaVersion: integer("progress_schema_version").notNull(),
    progress: jsonb("progress").$type<unknown>().notNull(),
  },
  (table) => [index("sync_tool_progress_call_idx").on(table.toolCallEventId)],
);

export const toolResults = sync.table("tool_results", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => sessionEvents.id, { onDelete: "restrict" }),
  accountId: uuid("account_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  toolCallEventId: uuid("tool_call_event_id")
    .notNull()
    .unique()
    .references(() => toolCalls.eventId, { onDelete: "restrict" }),
  outcome: text("outcome").notNull(),
  outputSchemaId: text("output_schema_id"),
  outputSchemaVersion: integer("output_schema_version"),
  output: jsonb("output").$type<unknown>(),
});

export const approvalRequests = sync.table("approval_requests", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => sessionEvents.id, { onDelete: "restrict" }),
  accountId: uuid("account_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  toolCallEventId: uuid("tool_call_event_id")
    .notNull()
    .unique()
    .references(() => toolCalls.eventId, { onDelete: "restrict" }),
  reason: text("reason").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const approvalDecisions = sync.table("approval_decisions", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => sessionEvents.id, { onDelete: "restrict" }),
  accountId: uuid("account_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  approvalRequestEventId: uuid("approval_request_event_id")
    .notNull()
    .unique()
    .references(() => approvalRequests.eventId, { onDelete: "restrict" }),
  decision: text("decision").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  note: text("note"),
});

export const syncErrors = sync.table("errors", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => sessionEvents.id, { onDelete: "restrict" }),
  accountId: uuid("account_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  code: text("code").notNull(),
  message: text("message").notNull(),
  retryable: boolean("retryable").notNull(),
  detailsSchemaId: text("details_schema_id"),
  details: jsonb("details").$type<unknown>(),
});

export const artifacts = sync.table(
  "artifacts",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => syncedSessions.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    artifactType: text("artifact_type").notNull(),
    storageKind: text("storage_kind").notNull(),
    supersedesArtifactId: uuid("supersedes_artifact_id"),
    createdByEventId: uuid("created_by_event_id")
      .notNull()
      .references(() => sessionEvents.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [unique("sync_artifacts_account_id_uq").on(table.accountId, table.id)],
);

export const fileArtifacts = sync.table("file_artifacts", {
  artifactId: uuid("artifact_id")
    .primaryKey()
    .references(() => artifacts.id, { onDelete: "restrict" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => platformAccounts.id, { onDelete: "restrict" }),
  mimeType: text("mime_type").notNull(),
  contentSha256: text("content_sha256").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  availability: text("availability").default("metadata_only").notNull(),
  remoteLocator: text("remote_locator"),
});

export const linkArtifacts = sync.table("link_artifacts", {
  artifactId: uuid("artifact_id")
    .primaryKey()
    .references(() => artifacts.id, { onDelete: "restrict" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => platformAccounts.id, { onDelete: "restrict" }),
  url: text("url").notNull(),
  provider: text("provider"),
  externalId: text("external_id"),
});

export const eventArtifacts = sync.table(
  "event_artifacts",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => sessionEvents.id, { onDelete: "restrict" }),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "restrict" }),
    relationship: text("relationship").notNull(),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.artifactId, table.relationship] })],
);

export const workspaceFiles = sync.table(
  "workspace_files",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "restrict" }),
    workspaceProjectId: uuid("workspace_project_id")
      .notNull()
      .references(() => workspaceProjects.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("sync_workspace_files_project_idx").on(table.accountId, table.workspaceProjectId)],
);

export const workspaceFileVersions = sync.table(
  "workspace_file_versions",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id").notNull(),
    workspaceProjectId: uuid("workspace_project_id").notNull(),
    workspaceFileId: uuid("workspace_file_id")
      .notNull()
      .references(() => workspaceFiles.id, { onDelete: "restrict" }),
    relativePath: text("relative_path").notNull(),
    mimeType: text("mime_type"),
    contentSha256: text("content_sha256").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    availability: text("availability").default("metadata_only").notNull(),
  },
  (table) => [index("sync_workspace_file_versions_file_captured_idx").on(table.workspaceFileId, table.capturedAt)],
);

export const fileChanges = sync.table(
  "file_changes",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => sessionEvents.id, { onDelete: "restrict" }),
    accountId: uuid("account_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    agentRunId: uuid("agent_run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "restrict" }),
    workspaceProjectId: uuid("workspace_project_id").notNull(),
    workspaceFileId: uuid("workspace_file_id")
      .notNull()
      .references(() => workspaceFiles.id, { onDelete: "restrict" }),
    toolCallEventId: uuid("tool_call_event_id").references(() => toolCalls.eventId, {
      onDelete: "restrict",
    }),
    operation: text("operation").notNull(),
    beforeVersionId: uuid("before_version_id").references(() => workspaceFileVersions.id, {
      onDelete: "restrict",
    }),
    afterVersionId: uuid("after_version_id").references(() => workspaceFileVersions.id, {
      onDelete: "restrict",
    }),
    textDiff: jsonb("text_diff").$type<Record<string, unknown> | null>(),
  },
  (table) => [
    index("sync_file_changes_run_idx").on(table.agentRunId),
    index("sync_file_changes_file_idx").on(table.workspaceFileId),
  ],
);

export const changeEnvelopes = sync.table(
  "change_envelopes",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "restrict" }),
    changeId: uuid("change_id").notNull(),
    originDeviceId: uuid("origin_device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "restrict" }),
    workspaceProjectId: uuid("workspace_project_id"),
    projectRevision: bigint("project_revision", { mode: "number" }),
    sessionId: uuid("session_id"),
    sessionRevision: bigint("session_revision", { mode: "number" }),
    kind: text("kind").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    envelope: jsonb("envelope").$type<Record<string, unknown>>().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("sync_change_envelopes_account_change_uq").on(table.accountId, table.changeId),
    index("sync_change_envelopes_account_cursor_idx").on(table.accountId, table.id),
  ],
);
