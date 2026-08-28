import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { id, timestamp } from "./common.js";
import * as workspace from "./workspace.js";
const {
  clientInstances,
  fileArtifacts,
  projects,
  sessionEvents,
  sessions,
} = workspace;

export const syncConnections = sqliteTable(
  "sync_connections",
  {
    id: text("id").primaryKey(),
    providerKey: text("provider_key").notNull(),
    endpointUrl: text("endpoint_url").notNull(),
    credentialRef: text("credential_ref"),
    remoteSubject: text("remote_subject"),
    accountLabel: text("account_label"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("sync_connections_provider_endpoint_uq").on(
      table.providerKey,
      table.endpointUrl,
    ),
  ],
);

export const localChanges = sqliteTable(
  "local_changes",
  {
    id: text("id").primaryKey(),
    originClientInstanceId: id("origin_client_instance_id").references(
      () => clientInstances.id,
      { onDelete: "restrict" },
    ),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "restrict",
    }),
    projectRevision: integer("project_revision"),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "restrict",
    }),
    sessionRevision: integer("session_revision"),
    eventId: text("event_id").references(() => sessionEvents.id, {
      onDelete: "restrict",
    }),
    kind: text("kind", {
      enum: [
        "project.upsert",
        "project.delete",
        "session.upsert",
        "session.event.append",
        "session.delete",
      ],
    }).notNull(),
    payloadSchemaVersion: integer("payload_schema_version").notNull(),
    payloadJson: text("payload_json").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("local_changes_project_revision_uq")
      .on(table.projectId, table.projectRevision)
      .where(sql`${table.projectId} is not null`),
    uniqueIndex("local_changes_session_revision_uq")
      .on(table.sessionId, table.sessionRevision)
      .where(sql`${table.sessionId} is not null`),
    uniqueIndex("local_changes_event_uq")
      .on(table.eventId)
      .where(sql`${table.eventId} is not null`),
    index("local_changes_created_at_idx").on(table.createdAtMs),
    check(
      "local_changes_kind_valid",
      sql`${table.kind} in ('project.upsert', 'project.delete', 'session.upsert', 'session.event.append', 'session.delete')`,
    ),
    check(
      "local_changes_target_matches_kind",
      sql`(
        (${table.kind} in ('project.upsert', 'project.delete') and ${table.projectId} is not null and ${table.projectRevision} is not null and ${table.sessionId} is null and ${table.sessionRevision} is null and ${table.eventId} is null)
        or
        (${table.kind} in ('session.upsert', 'session.event.append', 'session.delete') and ${table.projectId} is null and ${table.projectRevision} is null and ${table.sessionId} is not null and ${table.sessionRevision} is not null)
      )`,
    ),
    check(
      "local_changes_payload_schema_version_positive",
      sql`${table.payloadSchemaVersion} > 0`,
    ),
    check(
      "local_changes_hash_valid",
      sql`length(${table.payloadSha256}) = 64 and ${table.payloadSha256} not glob '*[^0-9a-f]*'`,
    ),
  ],
);

export const syncDeliveries = sqliteTable(
  "sync_deliveries",
  {
    connectionId: id("connection_id").references(() => syncConnections.id, {
      onDelete: "cascade",
    }),
    changeId: id("change_id").references(() => localChanges.id, {
      onDelete: "restrict",
    }),
    state: text("state", {
      enum: ["pending", "in_flight", "acked", "rejected"],
    })
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAtMs: timestamp("next_attempt_at_ms"),
    ackedAtMs: timestamp("acked_at_ms"),
    lastErrorCode: text("last_error_code"),
  },
  (table) => [
    primaryKey({ columns: [table.connectionId, table.changeId] }),
    index("sync_deliveries_claim_idx").on(
      table.connectionId,
      table.state,
      table.nextAttemptAtMs,
    ),
    check(
      "sync_deliveries_state_valid",
      sql`${table.state} in ('pending', 'in_flight', 'acked', 'rejected')`,
    ),
    check("sync_deliveries_attempts_valid", sql`${table.attemptCount} >= 0`),
  ],
);

export const artifactTransfers = sqliteTable(
  "artifact_transfers",
  {
    connectionId: id("connection_id").references(() => syncConnections.id, {
      onDelete: "cascade",
    }),
    artifactId: id("artifact_id").references(() => fileArtifacts.artifactId, {
      onDelete: "cascade",
    }),
    state: text("state", {
      enum: ["pending", "uploading", "available", "rejected"],
    })
      .notNull()
      .default("pending"),
    remoteLocator: text("remote_locator"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAtMs: timestamp("next_attempt_at_ms"),
    completedAtMs: timestamp("completed_at_ms"),
    lastErrorCode: text("last_error_code"),
  },
  (table) => [
    primaryKey({ columns: [table.connectionId, table.artifactId] }),
    check(
      "artifact_transfers_state_valid",
      sql`${table.state} in ('pending', 'uploading', 'available', 'rejected')`,
    ),
    check("artifact_transfers_attempts_valid", sql`${table.attemptCount} >= 0`),
  ],
);

export const syncCursors = sqliteTable(
  "sync_cursors",
  {
    connectionId: id("connection_id").references(() => syncConnections.id, {
      onDelete: "cascade",
    }),
    stream: text("stream").notNull(),
    pullCursor: text("pull_cursor"),
    lastPullAtMs: timestamp("last_pull_at_ms"),
    lastSuccessAtMs: timestamp("last_success_at_ms"),
  },
  (table) => [primaryKey({ columns: [table.connectionId, table.stream] })],
);

export const syncInbox = sqliteTable(
  "sync_inbox",
  {
    connectionId: id("connection_id").references(() => syncConnections.id, {
      onDelete: "cascade",
    }),
    remoteChangeId: text("remote_change_id").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    receivedAtMs: integer("received_at_ms").notNull(),
    appliedAtMs: integer("applied_at_ms").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.connectionId, table.remoteChangeId] }),
    check(
      "sync_inbox_hash_valid",
      sql`length(${table.payloadSha256}) = 64 and ${table.payloadSha256} not glob '*[^0-9a-f]*'`,
    ),
  ],
);
