import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  agentDeployments,
  agentEnvironmentRevisions,
  agentEnvironments,
  agents,
} from "./agents.js";
import { bytea, radiusPlatform } from "./common.js";
import {
  agentInstallations,
  clientInstallations,
  physicalDevices,
} from "./installations.js";
import {
  developerTokens,
  organizationMemberships,
  organizations,
} from "./organizations.js";

export const idempotencyRecords = radiusPlatform.table(
  "idempotency_records",
  {
    id: uuid("idempotency_record_id").primaryKey(),
    authorityFingerprint: bytea("authority_fingerprint").notNull(),
    operationCode: text("operation_code").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    recordState: text("record_state").notNull().default("pending"),
    responseStatus: smallint("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
    resourceReference: text("resource_reference"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("idempotency_records_expiry_idx").on(table.expiresAt),
    uniqueIndex("idempotency_records_authority_operation_key").on(
      table.authorityFingerprint,
      table.operationCode,
      table.idempotencyKey,
    ),
    check(
      "idempotency_records_authority_check",
      sql`octet_length(${table.authorityFingerprint}) = 32`,
    ),
    check(
      "idempotency_records_operation_check",
      sql`${table.operationCode} ~ '^[a-z][a-z0-9_.:-]{1,127}$'`,
    ),
    check(
      "idempotency_records_key_check",
      sql`char_length(${table.idempotencyKey}) BETWEEN 8 AND 240`,
    ),
    check(
      "idempotency_records_request_digest_check",
      sql`${table.requestDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "idempotency_records_state_check",
      sql`${table.recordState} IN ('pending', 'completed')`,
    ),
    check(
      "idempotency_records_response_check",
      sql`(${table.recordState} = 'pending' AND ${table.responseStatus} IS NULL AND ${table.responseBody} IS NULL) OR (${table.recordState} = 'completed' AND ${table.responseStatus} BETWEEN 100 AND 599 AND ${table.responseBody} IS NOT NULL)`,
    ),
    check(
      "idempotency_records_response_body_check",
      sql`${table.responseBody} IS NULL OR jsonb_typeof(${table.responseBody}) = 'object'`,
    ),
    check(
      "idempotency_records_resource_check",
      sql`${table.resourceReference} IS NULL OR char_length(${table.resourceReference}) <= 1024`,
    ),
    check(
      "idempotency_records_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export const jobOutboxMessages = radiusPlatform.table(
  "job_outbox_messages",
  {
    id: uuid("outbox_message_id").primaryKey(),
    aggregateCode: text("aggregate_code").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    jobName: text("job_name").notNull(),
    jobVersion: smallint("job_version").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    jobIdempotencyKey: text("job_idempotency_key").notNull(),
    messageState: text("message_state").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    terminalErrorCode: text("terminal_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    index("job_outbox_ready_idx")
      .on(table.availableAt, table.id)
      .where(sql`${table.messageState} = 'pending'`),
    uniqueIndex("job_outbox_idempotency_key").on(table.jobIdempotencyKey),
    check(
      "job_outbox_aggregate_check",
      sql`${table.aggregateCode} ~ '^[a-z][a-z0-9_.:-]{1,127}$'`,
    ),
    check(
      "job_outbox_name_check",
      sql`${table.jobName} ~ '^[a-z][a-z0-9_.:-]{1,127}$'`,
    ),
    check("job_outbox_version_check", sql`${table.jobVersion} > 0`),
    check(
      "job_outbox_payload_check",
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
    check(
      "job_outbox_idempotency_key_check",
      sql`char_length(${table.jobIdempotencyKey}) BETWEEN 8 AND 240`,
    ),
    check(
      "job_outbox_state_check",
      sql`${table.messageState} IN ('pending', 'published', 'failed')`,
    ),
    check("job_outbox_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check(
      "job_outbox_published_check",
      sql`(${table.messageState} = 'published' AND ${table.publishedAt} IS NOT NULL) OR (${table.messageState} <> 'published' AND ${table.publishedAt} IS NULL)`,
    ),
    check(
      "job_outbox_terminal_error_check",
      sql`(${table.messageState} = 'failed' AND ${table.terminalErrorCode} IS NOT NULL) OR (${table.messageState} <> 'failed' AND ${table.terminalErrorCode} IS NULL)`,
    ),
    check(
      "job_outbox_terminal_error_code_check",
      sql`${table.terminalErrorCode} IS NULL OR ${table.terminalErrorCode} ~ '^[A-Z][A-Z0-9_]{1,127}$'`,
    ),
    check(
      "job_outbox_timestamps_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const auditEvents = radiusPlatform.table(
  "audit_events",
  {
    id: uuid("audit_event_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    eventKey: text("event_key"),
    actorMembershipId: uuid("actor_membership_id").references(
      () => organizationMemberships.id,
      { onDelete: "restrict" },
    ),
    actorDeveloperTokenId: uuid("actor_developer_token_id").references(
      () => developerTokens.id,
      { onDelete: "restrict" },
    ),
    systemActorCode: text("system_actor_code"),
    actionCode: text("action_code").notNull(),
    outcomeCode: text("outcome_code").notNull(),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    agentDeploymentId: uuid("agent_deployment_id").references(
      () => agentDeployments.id,
      { onDelete: "restrict" },
    ),
    environmentId: uuid("environment_id").references(
      () => agentEnvironments.id,
      { onDelete: "restrict" },
    ),
    agentEnvironmentRevisionId: uuid(
      "agent_environment_revision_id",
    ).references(() => agentEnvironmentRevisions.id, { onDelete: "restrict" }),
    physicalDeviceId: uuid("physical_device_id"),
    clientInstallationId: uuid("client_installation_id"),
    agentInstallationId: uuid("agent_installation_id"),
    requestId: uuid("request_id"),
    safeMetadata: jsonb("safe_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    foreignKey({
      name: "audit_events_physical_device_fk",
      columns: [table.physicalDeviceId, table.organizationId],
      foreignColumns: [physicalDevices.id, physicalDevices.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "audit_events_client_installation_fk",
      columns: [table.clientInstallationId, table.organizationId],
      foreignColumns: [
        clientInstallations.id,
        clientInstallations.organizationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "audit_events_agent_installation_fk",
      columns: [table.agentInstallationId, table.organizationId],
      foreignColumns: [
        agentInstallations.id,
        agentInstallations.organizationId,
      ],
    }).onDelete("restrict"),
    index("audit_events_organization_occurred_idx").on(
      table.organizationId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    index("audit_events_agent_occurred_idx")
      .on(table.agentId, table.occurredAt.desc())
      .where(sql`${table.agentId} IS NOT NULL`),
    index("audit_events_request_idx")
      .on(table.requestId)
      .where(sql`${table.requestId} IS NOT NULL`),
    uniqueIndex("audit_events_organization_event_key").on(
      table.organizationId,
      table.eventKey,
    ),
    check(
      "audit_events_event_key_check",
      sql`${table.eventKey} IS NULL OR char_length(${table.eventKey}) BETWEEN 1 AND 240`,
    ),
    check(
      "audit_events_actor_check",
      sql`num_nonnulls(${table.actorMembershipId}, ${table.actorDeveloperTokenId}, ${table.systemActorCode}) = 1`,
    ),
    check(
      "audit_events_system_actor_check",
      sql`${table.systemActorCode} IS NULL OR ${table.systemActorCode} ~ '^[a-z][a-z0-9_.:-]{1,127}$'`,
    ),
    check(
      "audit_events_action_check",
      sql`${table.actionCode} ~ '^[a-z][a-z0-9_.:-]{1,127}$'`,
    ),
    check(
      "audit_events_outcome_check",
      sql`${table.outcomeCode} IN ('success', 'denied', 'failure')`,
    ),
    check(
      "audit_events_metadata_check",
      sql`jsonb_typeof(${table.safeMetadata}) = 'object'`,
    ),
  ],
);
