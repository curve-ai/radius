import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { radiusSync } from "../common.js";
import { organizations } from "../organizations.js";
import { syncDevices, syncSessions } from "./core.js";

export const syncSessionEvents = radiusSync.table(
  "session_events",
  {
    id: uuid("event_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id").notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => syncSessions.id, { onDelete: "cascade" }),
    // Matches sessions.revision: a narrower column would fail the insert
    // rather than the change, long after the revision was accepted.
    sessionRevision: bigint("session_revision", { mode: "number" }).notNull(),
    eventType: text("event_type").notNull(),
    agentRunId: uuid("agent_run_id"),
    sourceClientInstanceId: uuid("source_client_instance_id")
      .notNull()
      .references(() => syncDevices.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("sync_session_events_membership_event_key").on(
      table.membershipId,
      table.id,
    ),
    uniqueIndex("sync_session_events_membership_session_revision_key").on(
      table.membershipId,
      table.sessionId,
      table.sessionRevision,
    ),
    index("sync_session_events_run_occurred_idx").on(
      table.membershipId,
      table.agentRunId,
      table.occurredAt,
    ),
    index("sync_session_events_organization_occurred_idx").on(
      table.organizationId,
      table.occurredAt,
    ),
  ],
);

export const syncMessages = radiusSync.table("messages", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => syncSessionEvents.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  messageKind: text("message_kind").notNull(),
  status: text("status").notNull(),
  model: text("model"),
  providerMessageId: text("provider_message_id"),
  finishReason: text("finish_reason"),
});

export const syncMessageParts = radiusSync.table(
  "message_parts",
  {
    id: uuid("part_id").primaryKey(),
    messageEventId: uuid("message_event_id")
      .notNull()
      .references(() => syncMessages.eventId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    partType: text("part_type").notNull(),
    text: text("text"),
    artifactId: uuid("artifact_id"),
  },
  (table) => [
    uniqueIndex("sync_message_parts_position_key").on(
      table.messageEventId,
      table.position,
    ),
  ],
);

export const syncAgentRuns = radiusSync.table(
  "agent_runs",
  {
    id: uuid("agent_run_id").primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => syncSessionEvents.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => syncSessions.id, { onDelete: "cascade" }),
    providerKey: text("provider_key").notNull(),
    providerRunId: text("provider_run_id"),
    triggeringMessageEventId: uuid("triggering_message_event_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("sync_agent_runs_event_key").on(table.eventId),
    uniqueIndex("sync_agent_runs_provider_run_key")
      .on(table.providerKey, table.providerRunId)
      .where(sql`${table.providerRunId} IS NOT NULL`),
    index("sync_agent_runs_session_started_idx").on(
      table.sessionId,
      table.startedAt,
    ),
  ],
);

export const syncAgentRunStateUpdates = radiusSync.table(
  "agent_run_state_updates",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => syncSessionEvents.id, { onDelete: "cascade" }),
    agentRunId: uuid("agent_run_id")
      .notNull()
      .references(() => syncAgentRuns.id, { onDelete: "cascade" }),
    state: text("state").notNull(),
    detail: text("detail"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
);

export const syncAgentRunPresentations = radiusSync.table(
  "agent_run_presentations",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => syncSessionEvents.id, { onDelete: "cascade" }),
    agentRunId: uuid("agent_run_id")
      .notNull()
      .references(() => syncAgentRuns.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    initialState: text("initial_state"),
    summaryMessageEventId: uuid("summary_message_event_id"),
    label: text("label"),
  },
  (table) => [
    uniqueIndex("sync_agent_run_presentations_run_key").on(table.agentRunId),
  ],
);

export const syncReasoningSummaries = radiusSync.table("reasoning_summaries", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => syncSessionEvents.id, { onDelete: "cascade" }),
  summaryKind: text("summary_kind").notNull(),
  summaryText: text("summary_text").notNull(),
});

export const syncTaskPlans = radiusSync.table(
  "task_plans",
  {
    id: uuid("plan_id").primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => syncSessionEvents.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    supersedesPlanId: uuid("supersedes_plan_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("sync_task_plans_event_key").on(table.eventId)],
);

export const syncTaskSteps = radiusSync.table(
  "task_steps",
  {
    id: uuid("task_step_id").primaryKey(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => syncTaskPlans.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
  },
  (table) => [
    uniqueIndex("sync_task_steps_position_key").on(
      table.planId,
      table.position,
    ),
  ],
);

export const syncTaskStepUpdates = radiusSync.table("task_step_updates", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => syncSessionEvents.id, { onDelete: "cascade" }),
  taskStepId: uuid("task_step_id")
    .notNull()
    .references(() => syncTaskSteps.id, { onDelete: "cascade" }),
  state: text("state").notNull(),
  detail: text("detail"),
});

export const syncToolCalls = radiusSync.table("tool_calls", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => syncSessionEvents.id, { onDelete: "cascade" }),
  triggeringMessageEventId: uuid("triggering_message_event_id"),
  capability: text("capability").notNull(),
  operation: text("operation").notNull(),
  inputSchemaId: text("input_schema_id").notNull(),
  inputSchemaVersion: integer("input_schema_version").notNull(),
  input: jsonb("input").$type<unknown>().notNull(),
});

export const syncToolProgressEvents = radiusSync.table("tool_progress_events", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => syncSessionEvents.id, { onDelete: "cascade" }),
  toolCallEventId: uuid("tool_call_event_id")
    .notNull()
    .references(() => syncToolCalls.eventId, { onDelete: "cascade" }),
  progressSchemaId: text("progress_schema_id").notNull(),
  progressSchemaVersion: integer("progress_schema_version").notNull(),
  progress: jsonb("progress").$type<unknown>().notNull(),
});

export const syncToolResults = radiusSync.table(
  "tool_results",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => syncSessionEvents.id, { onDelete: "cascade" }),
    toolCallEventId: uuid("tool_call_event_id")
      .notNull()
      .references(() => syncToolCalls.eventId, { onDelete: "cascade" }),
    outcome: text("outcome").notNull(),
    outputSchemaId: text("output_schema_id"),
    outputSchemaVersion: integer("output_schema_version"),
    output: jsonb("output").$type<unknown>(),
  },
  (table) => [
    uniqueIndex("sync_tool_results_call_key").on(table.toolCallEventId),
  ],
);

export const syncApprovalRequests = radiusSync.table(
  "approval_requests",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => syncSessionEvents.id, { onDelete: "cascade" }),
    toolCallEventId: uuid("tool_call_event_id")
      .notNull()
      .references(() => syncToolCalls.eventId, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("sync_approval_requests_call_key").on(table.toolCallEventId),
  ],
);

export const syncApprovalDecisions = radiusSync.table(
  "approval_decisions",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => syncSessionEvents.id, { onDelete: "cascade" }),
    approvalRequestEventId: uuid("approval_request_event_id")
      .notNull()
      .references(() => syncApprovalRequests.eventId, { onDelete: "cascade" }),
    decision: text("decision").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("sync_approval_decisions_request_key").on(
      table.approvalRequestEventId,
    ),
  ],
);

export const syncErrors = radiusSync.table("errors", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => syncSessionEvents.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  message: text("message").notNull(),
  retryable: boolean("retryable").notNull(),
  detailsSchemaId: text("details_schema_id"),
  details: jsonb("details").$type<unknown>(),
});
