import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { id, timestamp } from "./common.js";
import * as workspace from "./workspace.js";
const { clientInstances, sessions } = workspace;

export const schedules = sqliteTable(
  "schedules",
  {
    id: text("id").primaryKey(),
    originClientInstanceId: id("origin_client_instance_id").references(
      () => clientInstances.id,
      { onDelete: "restrict" },
    ),
    title: text("title").notNull(),
    cronExpression: text("cron_expression").notNull(),
    timezone: text("timezone").notNull(),
    missedRunPolicy: text("missed_run_policy", {
      enum: ["catch_up_once", "skip", "ask", "replay_all"],
    })
      .notNull()
      .default("catch_up_once"),
    maxCatchUpAgeMs: integer("max_catch_up_age_ms")
      .notNull()
      .default(86_400_000),
    replayLimit: integer("replay_limit").notNull().default(20),
    requestSchemaId: text("request_schema_id").notNull(),
    requestSchemaVersion: integer("request_schema_version").notNull(),
    requestJson: text("request_json").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    revision: integer("revision").notNull().default(1),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
    deletedAtMs: timestamp("deleted_at_ms"),
  },
  (table) => [
    index("schedules_active_idx").on(table.enabled, table.deletedAtMs),
    check("schedules_title_nonempty", sql`length(trim(${table.title})) > 0`),
    check(
      "schedules_cron_expression_nonempty",
      sql`length(trim(${table.cronExpression})) > 0`,
    ),
    check(
      "schedules_timezone_nonempty",
      sql`length(trim(${table.timezone})) > 0`,
    ),
    check(
      "schedules_missed_run_policy_valid",
      sql`${table.missedRunPolicy} in ('catch_up_once', 'skip', 'ask', 'replay_all')`,
    ),
    check(
      "schedules_max_catch_up_age_valid",
      sql`${table.maxCatchUpAgeMs} >= 0`,
    ),
    check("schedules_replay_limit_valid", sql`${table.replayLimit} > 0`),
    check(
      "schedules_request_schema_id_nonempty",
      sql`length(trim(${table.requestSchemaId})) > 0`,
    ),
    check(
      "schedules_request_schema_version_positive",
      sql`${table.requestSchemaVersion} > 0`,
    ),
    check(
      "schedules_request_json_valid",
      sql`json_valid(${table.requestJson})`,
    ),
    check("schedules_revision_positive", sql`${table.revision} > 0`),
    check(
      "schedules_timestamps_ordered",
      sql`${table.updatedAtMs} >= ${table.createdAtMs}`,
    ),
  ],
);

export const scheduledRuns = sqliteTable(
  "scheduled_runs",
  {
    id: text("id").primaryKey(),
    scheduleId: id("schedule_id").references(() => schedules.id, {
      onDelete: "restrict",
    }),
    scheduleRevision: integer("schedule_revision").notNull(),
    scheduledForMs: integer("scheduled_for_ms").notNull(),
    coalescedThroughMs: integer("coalesced_through_ms").notNull(),
    coalescedOccurrenceCount: integer("coalesced_occurrence_count")
      .notNull()
      .default(1),
    requestSchemaId: text("request_schema_id").notNull(),
    requestSchemaVersion: integer("request_schema_version").notNull(),
    requestJson: text("request_json").notNull(),
    state: text("state", {
      enum: [
        "pending",
        "leased",
        "dispatched",
        "completed",
        "failed",
        "cancelled",
        "skipped",
      ],
    })
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAtMs: timestamp("available_at_ms"),
    leaseToken: text("lease_token"),
    leaseExpiresAtMs: timestamp("lease_expires_at_ms"),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "restrict",
    }),
    createdAtMs: integer("created_at_ms").notNull(),
    startedAtMs: timestamp("started_at_ms"),
    finishedAtMs: timestamp("finished_at_ms"),
    lastErrorCode: text("last_error_code"),
  },
  (table) => [
    uniqueIndex("scheduled_runs_occurrence_uq").on(
      table.scheduleId,
      table.scheduledForMs,
    ),
    uniqueIndex("scheduled_runs_session_uq")
      .on(table.sessionId)
      .where(sql`${table.sessionId} is not null`),
    index("scheduled_runs_claim_idx").on(
      table.state,
      table.availableAtMs,
      table.leaseExpiresAtMs,
    ),
    index("scheduled_runs_schedule_revision_idx").on(
      table.scheduleId,
      table.scheduleRevision,
      table.coalescedThroughMs,
    ),
    check(
      "scheduled_runs_schedule_revision_positive",
      sql`${table.scheduleRevision} > 0`,
    ),
    check(
      "scheduled_runs_coalesced_range_valid",
      sql`${table.coalescedThroughMs} >= ${table.scheduledForMs}`,
    ),
    check(
      "scheduled_runs_coalesced_count_positive",
      sql`${table.coalescedOccurrenceCount} > 0`,
    ),
    check(
      "scheduled_runs_request_schema_id_nonempty",
      sql`length(trim(${table.requestSchemaId})) > 0`,
    ),
    check(
      "scheduled_runs_request_schema_version_positive",
      sql`${table.requestSchemaVersion} > 0`,
    ),
    check(
      "scheduled_runs_request_json_valid",
      sql`json_valid(${table.requestJson})`,
    ),
    check(
      "scheduled_runs_state_valid",
      sql`${table.state} in ('pending', 'leased', 'dispatched', 'completed', 'failed', 'cancelled', 'skipped')`,
    ),
    check(
      "scheduled_runs_attempt_count_valid",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "scheduled_runs_lease_matches_state",
      sql`(
        (${table.state} = 'leased' and ${table.leaseToken} is not null and ${table.leaseExpiresAtMs} is not null)
        or
        (${table.state} != 'leased' and ${table.leaseToken} is null and ${table.leaseExpiresAtMs} is null)
      )`,
    ),
    check(
      "scheduled_runs_finished_matches_state",
      sql`(
        (${table.state} in ('completed', 'failed', 'cancelled', 'skipped') and ${table.finishedAtMs} is not null)
        or
        (${table.state} not in ('completed', 'failed', 'cancelled', 'skipped') and ${table.finishedAtMs} is null)
      )`,
    ),
    check(
      "scheduled_runs_session_matches_state",
      sql`${table.sessionId} is null or ${table.state} in ('dispatched', 'completed', 'failed', 'cancelled')`,
    ),
  ],
);
