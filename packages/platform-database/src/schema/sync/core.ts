import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { radiusSync } from "../common.js";
import {
  organizationMemberships,
  organizations,
} from "../organizations.js";

/**
 * A device that pushes conversations.
 *
 * Ownership is a membership rather than an account: the same person in two
 * organizations syncs into two separate sets of conversations, and revoking
 * their membership must take the device's access with it.
 */
export const syncDevices = radiusSync.table(
  "devices",
  {
    id: uuid("device_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id").notNull(),
    // Set once the desktop has also registered itself through
    // /client-installations. Sync must work before that has happened, so the
    // link is optional rather than a precondition.
    clientInstallationId: uuid("client_installation_id"),
    displayName: text("display_name").notNull(),
    platform: text("platform").notNull(),
    publicKeyJwk: jsonb("public_key_jwk").$type<JsonWebKey>().notNull(),
    appVersion: text("app_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "sync_devices_membership_fk",
      columns: [table.membershipId, table.organizationId],
      foreignColumns: [
        organizationMemberships.id,
        organizationMemberships.organizationId,
      ],
    }).onDelete("cascade"),
    unique("sync_devices_identity_key").on(table.id, table.organizationId),
    index("sync_devices_membership_revoked_idx").on(
      table.membershipId,
      table.revokedAt,
    ),
  ],
);

export const syncProjects = radiusSync.table(
  "projects",
  {
    id: uuid("project_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id").notNull(),
    originDeviceId: uuid("origin_device_id")
      .notNull()
      .references(() => syncDevices.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    foreignKey({
      name: "sync_projects_membership_fk",
      columns: [table.membershipId, table.organizationId],
      foreignColumns: [
        organizationMemberships.id,
        organizationMemberships.organizationId,
      ],
    }).onDelete("cascade"),
    unique("sync_projects_identity_key").on(table.id, table.organizationId),
    unique("sync_projects_membership_identity_key").on(
      table.membershipId,
      table.id,
    ),
    index("sync_projects_membership_updated_idx").on(
      table.membershipId,
      table.updatedAt.desc(),
    ),
    check("sync_projects_revision_check", sql`${table.revision} > 0`),
  ],
);

export const syncSessions = radiusSync.table(
  "sessions",
  {
    id: uuid("session_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id").notNull(),
    originDeviceId: uuid("origin_device_id")
      .notNull()
      .references(() => syncDevices.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => syncProjects.id, {
      onDelete: "restrict",
    }),
    title: text("title").notNull(),
    status: text("status").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    foreignKey({
      name: "sync_sessions_membership_fk",
      columns: [table.membershipId, table.organizationId],
      foreignColumns: [
        organizationMemberships.id,
        organizationMemberships.organizationId,
      ],
    }).onDelete("cascade"),
    unique("sync_sessions_identity_key").on(table.id, table.organizationId),
    unique("sync_sessions_membership_identity_key").on(
      table.membershipId,
      table.id,
    ),
    index("sync_sessions_membership_project_updated_idx").on(
      table.membershipId,
      table.projectId,
      table.updatedAt.desc(),
    ),
    index("sync_sessions_membership_updated_idx").on(
      table.membershipId,
      table.updatedAt.desc(),
    ),
    index("sync_sessions_organization_updated_idx").on(
      table.organizationId,
      table.updatedAt.desc(),
    ),
    check(
      "sync_sessions_status_check",
      sql`${table.status} IN ('active', 'completed', 'cancelled', 'failed')`,
    ),
    check("sync_sessions_revision_check", sql`${table.revision} > 0`),
  ],
);

export const syncChanges = radiusSync.table(
  "changes",
  {
    sequence: bigint("change_sequence", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id").notNull(),
    changeId: uuid("change_id").notNull(),
    originDeviceId: uuid("origin_device_id")
      .notNull()
      .references(() => syncDevices.id, { onDelete: "restrict" }),
    projectId: uuid("project_id"),
    projectRevision: bigint("project_revision", { mode: "number" }),
    sessionId: uuid("session_id"),
    sessionRevision: bigint("session_revision", { mode: "number" }),
    kind: text("kind").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    envelope: jsonb("envelope").$type<Record<string, unknown>>().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    foreignKey({
      name: "sync_changes_membership_fk",
      columns: [table.membershipId, table.organizationId],
      foreignColumns: [
        organizationMemberships.id,
        organizationMemberships.organizationId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("sync_changes_membership_change_key").on(
      table.membershipId,
      table.changeId,
    ),
    uniqueIndex("sync_changes_membership_project_revision_key")
      .on(table.membershipId, table.projectId, table.projectRevision)
      .where(sql`${table.projectId} IS NOT NULL`),
    uniqueIndex("sync_changes_membership_session_revision_key")
      .on(table.membershipId, table.sessionId, table.sessionRevision)
      .where(sql`${table.sessionId} IS NOT NULL`),
    // The pull cursor walks this index, so it leads with the membership the
    // caller is allowed to read.
    index("sync_changes_membership_sequence_idx").on(
      table.membershipId,
      table.sequence,
    ),
    check(
      "sync_changes_subject_check",
      sql`num_nonnulls(${table.projectId}, ${table.sessionId}) = 1`,
    ),
    check(
      "sync_changes_project_revision_check",
      sql`(${table.projectId} IS NULL) = (${table.projectRevision} IS NULL)`,
    ),
    check(
      "sync_changes_session_revision_check",
      sql`(${table.sessionId} IS NULL) = (${table.sessionRevision} IS NULL)`,
    ),
    check(
      "sync_changes_digest_check",
      sql`${table.payloadSha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
