import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { radiusSync } from "../common.js";
import { organizations } from "../organizations.js";
import { syncSessionEvents } from "./events.js";
import { syncSessions } from "./core.js";

export const syncArtifacts = radiusSync.table(
  "artifacts",
  {
    id: uuid("artifact_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id").notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => syncSessions.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    artifactType: text("artifact_type").notNull(),
    storageKind: text("storage_kind").notNull(),
    supersedesArtifactId: uuid("supersedes_artifact_id"),
    createdByEventId: uuid("created_by_event_id")
      .notNull()
      .references(() => syncSessionEvents.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("sync_artifacts_identity_key").on(table.id, table.organizationId),
    unique("sync_artifacts_membership_identity_key").on(
      table.membershipId,
      table.id,
    ),
    check(
      "sync_artifacts_storage_kind_check",
      sql`${table.storageKind} IN ('file', 'link')`,
    ),
  ],
);

export const syncFileArtifacts = radiusSync.table(
  "file_artifacts",
  {
    artifactId: uuid("artifact_id")
      .primaryKey()
      .references(() => syncArtifacts.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id").notNull(),
    mimeType: text("mime_type").notNull(),
    contentSha256: text("content_sha256").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    availability: text("availability").notNull().default("metadata_only"),
    remoteLocator: text("remote_locator"),
  },
  (table) => [
    index("sync_file_artifacts_content_idx").on(
      table.membershipId,
      table.contentSha256,
    ),
    check(
      "sync_file_artifacts_digest_check",
      sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check("sync_file_artifacts_size_check", sql`${table.byteSize} >= 0`),
    check(
      "sync_file_artifacts_availability_check",
      sql`${table.availability} IN ('metadata_only', 'available')`,
    ),
  ],
);

export const syncLinkArtifacts = radiusSync.table("link_artifacts", {
  artifactId: uuid("artifact_id")
    .primaryKey()
    .references(() => syncArtifacts.id, { onDelete: "restrict" }),
  url: text("url").notNull(),
  provider: text("provider").notNull(),
  externalId: text("external_id"),
});

export const syncEventArtifacts = radiusSync.table(
  "event_artifacts",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => syncSessionEvents.id, { onDelete: "restrict" }),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => syncArtifacts.id, { onDelete: "restrict" }),
    relationship: text("relationship").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.eventId, table.artifactId, table.relationship],
    }),
    check(
      "sync_event_artifacts_relationship_check",
      sql`${table.relationship} IN ('input', 'output', 'attachment', 'preview')`,
    ),
  ],
);
