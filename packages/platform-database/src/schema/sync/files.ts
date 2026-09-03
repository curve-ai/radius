import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { radiusSync } from "../common.js";
import { organizations } from "../organizations.js";
import { syncProjects } from "./core.js";
import { syncSessionEvents, syncToolCalls } from "./events.js";

export const syncProjectFiles = radiusSync.table(
  "project_files",
  {
    id: uuid("project_file_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => syncProjects.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("sync_project_files_identity_key").on(
      table.id,
      table.organizationId,
    ),
    index("sync_project_files_membership_project_idx").on(
      table.membershipId,
      table.projectId,
    ),
  ],
);

export const syncProjectFileVersions = radiusSync.table(
  "project_file_versions",
  {
    id: uuid("version_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => syncProjects.id, { onDelete: "restrict" }),
    projectFileId: uuid("project_file_id")
      .notNull()
      .references(() => syncProjectFiles.id, { onDelete: "restrict" }),
    relativePath: text("relative_path").notNull(),
    mimeType: text("mime_type").notNull(),
    contentSha256: text("content_sha256").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    availability: text("availability").notNull().default("metadata_only"),
  },
  (table) => [
    unique("sync_project_file_versions_identity_key").on(
      table.id,
      table.organizationId,
    ),
    index("sync_project_file_versions_file_captured_idx").on(
      table.membershipId,
      table.projectFileId,
      table.capturedAt,
    ),
    check(
      "sync_project_file_versions_digest_check",
      sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check("sync_project_file_versions_size_check", sql`${table.byteSize} >= 0`),
  ],
);

export const syncFileChanges = radiusSync.table(
  "file_changes",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => syncSessionEvents.id, { onDelete: "restrict" }),
    agentRunId: uuid("agent_run_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => syncProjects.id, { onDelete: "restrict" }),
    projectFileId: uuid("project_file_id")
      .notNull()
      .references(() => syncProjectFiles.id, { onDelete: "restrict" }),
    toolCallEventId: uuid("tool_call_event_id").references(
      () => syncToolCalls.eventId,
      { onDelete: "restrict" },
    ),
    operation: text("operation").notNull(),
    beforeVersionId: uuid("before_version_id").references(
      () => syncProjectFileVersions.id,
      { onDelete: "restrict" },
    ),
    afterVersionId: uuid("after_version_id").references(
      () => syncProjectFileVersions.id,
      { onDelete: "restrict" },
    ),
    textDiff: jsonb("text_diff").$type<{
      additions: number;
      deletions: number;
    }>(),
  },
  (table) => [
    index("sync_file_changes_run_idx").on(table.agentRunId),
    index("sync_file_changes_file_idx").on(table.projectFileId),
  ],
);
