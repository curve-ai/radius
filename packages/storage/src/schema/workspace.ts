import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

import { id, timestamp } from "./common.js";

export const clientInstances = sqliteTable("client_instances", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  platform: text("platform").notNull(),
  publicKeyJwk: text("public_key_jwk").notNull(),
  isLocal: integer("is_local", { mode: "boolean" }).notNull().default(false),
  createdAtMs: integer("created_at_ms").notNull(),
  updatedAtMs: integer("updated_at_ms").notNull(),
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    originClientInstanceId: id("origin_client_instance_id").references(
      () => clientInstances.id,
      { onDelete: "restrict" },
    ),
    name: text("name").notNull(),
    revision: integer("revision").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
    archivedAtMs: timestamp("archived_at_ms"),
    deletedAtMs: timestamp("deleted_at_ms"),
  },
  (table) => [
    check("projects_name_nonempty", sql`length(trim(${table.name})) > 0`),
    check("projects_revision_positive", sql`${table.revision} > 0`),
    check(
      "projects_updated_after_created",
      sql`${table.updatedAtMs} >= ${table.createdAtMs}`,
    ),
    check(
      "projects_archived_after_created",
      sql`${table.archivedAtMs} is null or ${table.archivedAtMs} >= ${table.createdAtMs}`,
    ),
    check(
      "projects_deleted_after_created",
      sql`${table.deletedAtMs} is null or ${table.deletedAtMs} >= ${table.createdAtMs}`,
    ),
    index("projects_updated_at_idx").on(table.updatedAtMs),
  ],
);

export const projectRoots = sqliteTable(
  "project_roots",
  {
    id: text("id").primaryKey(),
    projectId: id("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    clientInstanceId: id("client_instance_id").references(
      () => clientInstances.id,
      { onDelete: "restrict" },
    ),
    rootPath: text("root_path").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    index("project_roots_project_client_idx").on(
      table.projectId,
      table.clientInstanceId,
    ),
    uniqueIndex("project_roots_client_path_uq").on(
      table.clientInstanceId,
      table.rootPath,
    ),
    check(
      "project_roots_path_nonempty",
      sql`length(trim(${table.rootPath})) > 0`,
    ),
    check(
      "project_roots_updated_after_created",
      sql`${table.updatedAtMs} >= ${table.createdAtMs}`,
    ),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    originClientInstanceId: id("origin_client_instance_id").references(
      () => clientInstances.id,
      { onDelete: "restrict" },
    ),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "restrict",
    }),
    title: text("title").notNull(),
    status: text("status", {
      enum: ["active", "completed", "cancelled", "failed"],
    }).notNull(),
    revision: integer("revision").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
    archivedAtMs: timestamp("archived_at_ms"),
    deletedAtMs: timestamp("deleted_at_ms"),
  },
  (table) => [
    check("sessions_title_nonempty", sql`length(trim(${table.title})) > 0`),
    check("sessions_revision_positive", sql`${table.revision} > 0`),
    check(
      "sessions_updated_after_created",
      sql`${table.updatedAtMs} >= ${table.createdAtMs}`,
    ),
    check(
      "sessions_archived_after_created",
      sql`${table.archivedAtMs} is null or ${table.archivedAtMs} >= ${table.createdAtMs}`,
    ),
    check(
      "sessions_deleted_after_created",
      sql`${table.deletedAtMs} is null or ${table.deletedAtMs} >= ${table.createdAtMs}`,
    ),
    check(
      "sessions_status_valid",
      sql`${table.status} in ('active', 'completed', 'cancelled', 'failed')`,
    ),
    index("sessions_updated_at_idx").on(table.updatedAtMs),
    index("sessions_project_updated_at_idx").on(
      table.projectId,
      table.updatedAtMs,
    ),
  ],
);

export const sessionPins = sqliteTable(
  "session_pins",
  {
    clientInstanceId: id("client_instance_id").references(
      () => clientInstances.id,
      { onDelete: "cascade" },
    ),
    sessionId: id("session_id").references(() => sessions.id, {
      onDelete: "cascade",
    }),
    pinnedAtMs: integer("pinned_at_ms").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.clientInstanceId, table.sessionId] }),
    check("session_pins_pinned_at_positive", sql`${table.pinnedAtMs} > 0`),
    index("session_pins_client_pinned_at_idx").on(
      table.clientInstanceId,
      table.pinnedAtMs,
    ),
  ],
);

export const sessionEvents = sqliteTable(
  "session_events",
  {
    id: text("id").primaryKey(),
    sessionId: id("session_id").references(() => sessions.id, {
      onDelete: "cascade",
    }),
    sessionRevision: integer("session_revision").notNull(),
    eventType: text("event_type", {
      enum: [
        "message",
        "agent_run",
        "agent_run_state_update",
        "agent_run_presentation",
        "reasoning_summary",
        "task_plan",
        "task_step_update",
        "tool_call",
        "tool_progress",
        "tool_result",
        "file_change",
        "approval_request",
        "approval_decision",
        "error",
      ],
    }).notNull(),
    sourceClientInstanceId: id("source_client_instance_id").references(
      () => clientInstances.id,
      { onDelete: "restrict" },
    ),
    occurredAtMs: integer("occurred_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("session_events_revision_uq").on(
      table.sessionId,
      table.sessionRevision,
    ),
    check(
      "session_events_revision_positive",
      sql`${table.sessionRevision} > 0`,
    ),
    check(
      "session_events_type_valid",
      sql`${table.eventType} in ('message', 'agent_run', 'agent_run_state_update', 'agent_run_presentation', 'reasoning_summary', 'task_plan', 'task_step_update', 'tool_call', 'tool_progress', 'tool_result', 'file_change', 'approval_request', 'approval_decision', 'error')`,
    ),
  ],
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    sessionId: id("session_id").references(() => sessions.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    artifactType: text("artifact_type", {
      enum: [
        "document",
        "presentation",
        "image",
        "dataset",
        "archive",
        "other",
      ],
    }).notNull(),
    createdByEventId: id("created_by_event_id").references(
      () => sessionEvents.id,
      { onDelete: "restrict" },
    ),
    supersedesArtifactId: text("supersedes_artifact_id").references(
      (): AnySQLiteColumn => artifacts.id,
      { onDelete: "restrict" },
    ),
    createdAtMs: integer("created_at_ms").notNull(),
    deletedAtMs: timestamp("deleted_at_ms"),
  },
  (table) => [
    check("artifacts_name_nonempty", sql`length(trim(${table.name})) > 0`),
    check(
      "artifacts_type_valid",
      sql`${table.artifactType} in ('document', 'presentation', 'image', 'dataset', 'archive', 'other')`,
    ),
  ],
);

export const fileArtifacts = sqliteTable(
  "file_artifacts",
  {
    artifactId: text("artifact_id")
      .primaryKey()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    mimeType: text("mime_type").notNull(),
    contentSha256: text("content_sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    availability: text("availability", {
      enum: ["local", "remote_only", "missing"],
    })
      .notNull()
      .default("local"),
    localRelativePath: text("local_relative_path"),
  },
  (table) => [
    check(
      "file_artifacts_hash_valid",
      sql`length(${table.contentSha256}) = 64 and ${table.contentSha256} not glob '*[^0-9a-f]*'`,
    ),
    check("file_artifacts_size_valid", sql`${table.byteSize} >= 0`),
    check(
      "file_artifacts_location_matches_availability",
      sql`(
        (${table.availability} = 'local' and ${table.localRelativePath} is not null)
        or
        (${table.availability} in ('remote_only', 'missing') and ${table.localRelativePath} is null)
      )`,
    ),
  ],
);

export const linkArtifacts = sqliteTable("link_artifacts", {
  artifactId: text("artifact_id")
    .primaryKey()
    .references(() => artifacts.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  provider: text("provider").notNull(),
  externalId: text("external_id"),
});

export const messages = sqliteTable(
  "messages",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => sessionEvents.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    messageKind: text("message_kind", {
      enum: ["prompt", "progress", "final", "run_summary", "system_notice"],
    }).notNull(),
    status: text("status", {
      enum: ["completed", "cancelled", "failed"],
    }).notNull(),
    model: text("model"),
    providerMessageId: text("provider_message_id"),
    finishReason: text("finish_reason"),
  },
  (table) => [
    check(
      "messages_role_valid",
      sql`${table.role} in ('user', 'assistant', 'system')`,
    ),
    check(
      "messages_status_valid",
      sql`${table.status} in ('completed', 'cancelled', 'failed')`,
    ),
    check(
      "messages_kind_valid",
      sql`${table.messageKind} in ('prompt', 'progress', 'final', 'run_summary', 'system_notice')`,
    ),
  ],
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    sessionId: id("session_id").references(() => sessions.id, {
      onDelete: "cascade",
    }),
    createdByEventId: id("created_by_event_id")
      .unique()
      .references(() => sessionEvents.id, { onDelete: "restrict" }),
    providerKey: text("provider_key").notNull(),
    providerRunId: text("provider_run_id"),
    triggeringMessageEventId: text("triggering_message_event_id").references(
      () => messages.eventId,
      { onDelete: "set null" },
    ),
    startedAtMs: integer("started_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("agent_runs_provider_run_uq")
      .on(table.providerKey, table.providerRunId)
      .where(sql`${table.providerRunId} is not null`),
    index("agent_runs_session_started_idx").on(
      table.sessionId,
      table.startedAtMs,
    ),
    check(
      "agent_runs_provider_key_nonempty",
      sql`length(trim(${table.providerKey})) > 0`,
    ),
  ],
);

export const eventRuns = sqliteTable("event_runs", {
  eventId: text("event_id")
    .primaryKey()
    .references(() => sessionEvents.id, { onDelete: "cascade" }),
  agentRunId: id("agent_run_id").references(() => agentRuns.id, {
    onDelete: "cascade",
  }),
});

export const agentRunStateUpdates = sqliteTable(
  "agent_run_state_updates",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => sessionEvents.id, { onDelete: "cascade" }),
    agentRunId: id("agent_run_id").references(() => agentRuns.id, {
      onDelete: "cascade",
    }),
    state: text("state", {
      enum: [
        "working",
        "waiting_for_approval",
        "waiting_for_user",
        "completed",
        "failed",
        "cancelled",
      ],
    }).notNull(),
    detail: text("detail"),
  },
  (table) => [
    check(
      "agent_run_state_updates_state_valid",
      sql`${table.state} in ('working', 'waiting_for_approval', 'waiting_for_user', 'completed', 'failed', 'cancelled')`,
    ),
  ],
);

export const agentRunPresentations = sqliteTable(
  "agent_run_presentations",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => sessionEvents.id, { onDelete: "cascade" }),
    agentRunId: id("agent_run_id")
      .unique()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: ["inline", "collapsible"] }).notNull(),
    initialState: text("initial_state", {
      enum: ["expanded", "collapsed"],
    }),
    summaryMessageEventId: text("summary_message_event_id").references(
      () => messages.eventId,
      { onDelete: "restrict" },
    ),
    label: text("label"),
  },
  (table) => [
    check(
      "agent_run_presentations_mode_valid",
      sql`${table.mode} in ('inline', 'collapsible')`,
    ),
    check(
      "agent_run_presentations_state_matches_mode",
      sql`(
        (${table.mode} = 'inline' and ${table.initialState} is null)
        or
        (${table.mode} = 'collapsible' and ${table.initialState} in ('expanded', 'collapsed'))
      )`,
    ),
    check(
      "agent_run_presentations_label_valid",
      sql`${table.label} is null or (length(trim(${table.label})) > 0 and length(${table.label}) <= 80)`,
    ),
  ],
);

export const messageParts = sqliteTable(
  "message_parts",
  {
    id: text("id").primaryKey(),
    messageEventId: id("message_event_id").references(() => messages.eventId, {
      onDelete: "cascade",
    }),
    position: integer("position").notNull(),
    partType: text("part_type", {
      enum: ["text", "artifact_reference"],
    }).notNull(),
    textContent: text("text_content"),
    artifactId: text("artifact_id").references(() => artifacts.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    uniqueIndex("message_parts_position_uq").on(
      table.messageEventId,
      table.position,
    ),
    check("message_parts_position_valid", sql`${table.position} >= 0`),
    check(
      "message_parts_value_matches_type",
      sql`(
        (${table.partType} = 'text' and ${table.textContent} is not null and ${table.artifactId} is null)
        or
        (${table.partType} = 'artifact_reference' and ${table.textContent} is null and ${table.artifactId} is not null)
      )`,
    ),
  ],
);

export const reasoningSummaries = sqliteTable(
  "reasoning_summaries",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => sessionEvents.id, { onDelete: "cascade" }),
    summaryText: text("summary_text").notNull(),
    summaryKind: text("summary_kind", {
      enum: ["analysis", "decision", "handoff"],
    }).notNull(),
  },
  (table) => [
    check(
      "reasoning_summaries_text_nonempty",
      sql`length(trim(${table.summaryText})) > 0`,
    ),
    check(
      "reasoning_summaries_kind_valid",
      sql`${table.summaryKind} in ('analysis', 'decision', 'handoff')`,
    ),
  ],
);

export const taskPlans = sqliteTable(
  "task_plans",
  {
    id: text("id").primaryKey(),
    sessionId: id("session_id").references(() => sessions.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    supersedesPlanId: text("supersedes_plan_id"),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.supersedesPlanId],
      foreignColumns: [table.id],
      name: "task_plans_supersedes_fk",
    }).onDelete("restrict"),
    check("task_plans_title_nonempty", sql`length(trim(${table.title})) > 0`),
  ],
);

export const taskSteps = sqliteTable(
  "task_steps",
  {
    id: text("id").primaryKey(),
    planId: id("plan_id").references(() => taskPlans.id, {
      onDelete: "cascade",
    }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
  },
  (table) => [
    uniqueIndex("task_steps_position_uq").on(table.planId, table.position),
    check("task_steps_position_valid", sql`${table.position} >= 0`),
    check("task_steps_title_nonempty", sql`length(trim(${table.title})) > 0`),
  ],
);

export const taskPlanEvents = sqliteTable("task_plan_events", {
  eventId: text("event_id")
    .primaryKey()
    .references(() => sessionEvents.id, { onDelete: "cascade" }),
  planId: id("plan_id")
    .unique()
    .references(() => taskPlans.id, { onDelete: "cascade" }),
});

export const taskStepUpdates = sqliteTable(
  "task_step_updates",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => sessionEvents.id, { onDelete: "cascade" }),
    taskStepId: id("task_step_id").references(() => taskSteps.id, {
      onDelete: "cascade",
    }),
    state: text("state", {
      enum: ["pending", "in_progress", "completed", "blocked", "skipped"],
    }).notNull(),
    detail: text("detail"),
  },
  (table) => [
    check(
      "task_step_updates_state_valid",
      sql`${table.state} in ('pending', 'in_progress', 'completed', 'blocked', 'skipped')`,
    ),
  ],
);

export const toolCalls = sqliteTable(
  "tool_calls",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => sessionEvents.id, { onDelete: "cascade" }),
    triggeringMessageEventId: text("triggering_message_event_id").references(
      () => messages.eventId,
      { onDelete: "set null" },
    ),
    capability: text("capability").notNull(),
    operation: text("operation").notNull(),
    inputSchemaId: text("input_schema_id").notNull(),
    inputSchemaVersion: integer("input_schema_version").notNull(),
    inputJson: text("input_json").notNull(),
  },
  (table) => [
    check(
      "tool_calls_input_schema_version_positive",
      sql`${table.inputSchemaVersion} > 0`,
    ),
  ],
);

export const toolProgressEvents = sqliteTable(
  "tool_progress_events",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => sessionEvents.id, { onDelete: "cascade" }),
    toolCallEventId: id("tool_call_event_id").references(
      () => toolCalls.eventId,
      { onDelete: "restrict" },
    ),
    progressSchemaId: text("progress_schema_id").notNull(),
    progressSchemaVersion: integer("progress_schema_version").notNull(),
    progressJson: text("progress_json").notNull(),
  },
  (table) => [
    index("tool_progress_events_call_idx").on(table.toolCallEventId),
    check(
      "tool_progress_events_schema_version_positive",
      sql`${table.progressSchemaVersion} > 0`,
    ),
  ],
);

export const toolResults = sqliteTable(
  "tool_results",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => sessionEvents.id, { onDelete: "cascade" }),
    toolCallEventId: id("tool_call_event_id").references(
      () => toolCalls.eventId,
      {
        onDelete: "restrict",
      },
    ),
    outcome: text("outcome", {
      enum: ["succeeded", "failed", "cancelled"],
    }).notNull(),
    outputSchemaId: text("output_schema_id").notNull(),
    outputSchemaVersion: integer("output_schema_version").notNull(),
    outputJson: text("output_json").notNull(),
  },
  (table) => [
    uniqueIndex("tool_results_call_uq").on(table.toolCallEventId),
    check(
      "tool_results_outcome_valid",
      sql`${table.outcome} in ('succeeded', 'failed', 'cancelled')`,
    ),
    check(
      "tool_results_output_schema_version_positive",
      sql`${table.outputSchemaVersion} > 0`,
    ),
  ],
);

export const projectFiles = sqliteTable(
  "project_files",
  {
    id: text("id").primaryKey(),
    projectId: id("project_id").references(() => projects.id, {
      onDelete: "restrict",
    }),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [index("project_files_project_idx").on(table.projectId)],
);

export const projectFileVersions = sqliteTable(
  "project_file_versions",
  {
    id: text("id").primaryKey(),
    projectFileId: id("project_file_id").references(() => projectFiles.id, {
      onDelete: "restrict",
    }),
    relativePath: text("relative_path").notNull(),
    mimeType: text("mime_type").notNull(),
    contentSha256: text("content_sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    availability: text("availability", {
      enum: ["local", "missing"],
    })
      .notNull()
      .default("local"),
    localRelativePath: text("local_relative_path"),
    capturedAtMs: integer("captured_at_ms").notNull(),
  },
  (table) => [
    index("project_file_versions_file_captured_idx").on(
      table.projectFileId,
      table.capturedAtMs,
    ),
    check(
      "project_file_versions_path_valid",
      sql`length(trim(${table.relativePath})) > 0 and ${table.relativePath} not like '/%' and instr(${table.relativePath}, '\\') = 0`,
    ),
    check(
      "project_file_versions_hash_valid",
      sql`length(${table.contentSha256}) = 64 and ${table.contentSha256} not glob '*[^0-9a-f]*'`,
    ),
    check("project_file_versions_size_valid", sql`${table.byteSize} >= 0`),
    check(
      "project_file_versions_location_matches_availability",
      sql`(
        (${table.availability} = 'local' and ${table.localRelativePath} is not null)
        or
        (${table.availability} = 'missing' and ${table.localRelativePath} is null)
      )`,
    ),
  ],
);

export const fileChanges = sqliteTable(
  "file_changes",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => sessionEvents.id, { onDelete: "cascade" }),
    projectFileId: id("project_file_id").references(() => projectFiles.id, {
      onDelete: "restrict",
    }),
    toolCallEventId: text("tool_call_event_id").references(
      () => toolCalls.eventId,
      { onDelete: "restrict" },
    ),
    operation: text("operation", {
      enum: ["create", "modify", "relocate", "delete"],
    }).notNull(),
    beforeVersionId: text("before_version_id").references(
      () => projectFileVersions.id,
      { onDelete: "restrict" },
    ),
    afterVersionId: text("after_version_id").references(
      () => projectFileVersions.id,
      { onDelete: "restrict" },
    ),
    textAdditions: integer("text_additions"),
    textDeletions: integer("text_deletions"),
  },
  (table) => [
    index("file_changes_file_idx").on(table.projectFileId),
    check(
      "file_changes_operation_valid",
      sql`${table.operation} in ('create', 'modify', 'relocate', 'delete')`,
    ),
    check(
      "file_changes_versions_match_operation",
      sql`(
        (${table.operation} = 'create' and ${table.beforeVersionId} is null and ${table.afterVersionId} is not null)
        or
        (${table.operation} in ('modify', 'relocate') and ${table.beforeVersionId} is not null and ${table.afterVersionId} is not null)
        or
        (${table.operation} = 'delete' and ${table.beforeVersionId} is not null and ${table.afterVersionId} is null)
      )`,
    ),
    check(
      "file_changes_text_diff_paired",
      sql`(
        (${table.textAdditions} is null and ${table.textDeletions} is null)
        or
        (${table.textAdditions} >= 0 and ${table.textDeletions} >= 0)
      )`,
    ),
  ],
);

export const approvalRequests = sqliteTable(
  "approval_requests",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => sessionEvents.id, { onDelete: "cascade" }),
    toolCallEventId: id("tool_call_event_id").references(
      () => toolCalls.eventId,
      {
        onDelete: "restrict",
      },
    ),
    reason: text("reason").notNull(),
    expiresAtMs: timestamp("expires_at_ms"),
  },
  (table) => [
    uniqueIndex("approval_requests_tool_call_uq").on(table.toolCallEventId),
  ],
);

export const approvalDecisions = sqliteTable(
  "approval_decisions",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => sessionEvents.id, { onDelete: "cascade" }),
    approvalRequestEventId: id("approval_request_event_id").references(
      () => approvalRequests.eventId,
      { onDelete: "restrict" },
    ),
    decision: text("decision", {
      enum: ["approved", "denied", "cancelled", "expired"],
    }).notNull(),
    actorType: text("actor_type", {
      enum: ["user", "organization_policy", "system"],
    }).notNull(),
    actorId: text("actor_id"),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("approval_decisions_request_uq").on(
      table.approvalRequestEventId,
    ),
    check(
      "approval_decisions_decision_valid",
      sql`${table.decision} in ('approved', 'denied', 'cancelled', 'expired')`,
    ),
    check(
      "approval_decisions_actor_type_valid",
      sql`${table.actorType} in ('user', 'organization_policy', 'system')`,
    ),
  ],
);

export const errors = sqliteTable("errors", {
  eventId: text("event_id")
    .primaryKey()
    .references(() => sessionEvents.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  message: text("message").notNull(),
  retryable: integer("retryable", { mode: "boolean" }).notNull(),
  detailsSchemaId: text("details_schema_id"),
  detailsJson: text("details_json"),
});

export const eventArtifacts = sqliteTable(
  "event_artifacts",
  {
    eventId: id("event_id").references(() => sessionEvents.id, {
      onDelete: "cascade",
    }),
    artifactId: id("artifact_id").references(() => artifacts.id, {
      onDelete: "cascade",
    }),
    relationship: text("relationship", {
      enum: ["input", "output", "attachment", "preview"],
    }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.eventId, table.artifactId, table.relationship],
    }),
    check(
      "event_artifacts_relationship_valid",
      sql`${table.relationship} in ('input', 'output', 'attachment', 'preview')`,
    ),
  ],
);
