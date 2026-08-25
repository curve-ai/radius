import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { platformAccounts, devices } from "./platform.js";

const connectors = pgSchema("connectors");

export const connectorCatalogEntries = connectors.table(
  "catalog_entries",
  {
    id: uuid("id").primaryKey(),
    source: text("source").notNull(),
    sourceServerName: text("source_server_name").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    featured: boolean("featured").default(false).notNull(),
    version: text("version").notNull(),
    transport: text("transport").notNull(),
    remoteUrl: text("remote_url").notNull(),
    repositoryUrl: text("repository_url"),
    websiteUrl: text("website_url"),
    domain: text("domain"),
    logoUrl: text("logo_url"),
    sourceStatus: text("source_status").default("active").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    registryUpdatedAt: timestamp("registry_updated_at", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("connector_catalog_source_name_uq").on(table.source, table.sourceServerName),
    index("connector_catalog_featured_category_title_idx").on(
      table.featured,
      table.category,
      table.title,
      table.id,
    ),
    index("connector_catalog_domain_idx").on(table.domain),
    index("connector_catalog_search_idx").using(
      "gin",
      sql`to_tsvector('english', coalesce(${table.title}, '') || ' ' || coalesce(${table.description}, ''))`,
    ),
  ],
);

export const connectorCatalogIngestionRuns = connectors.table(
  "catalog_ingestion_runs",
  {
    id: uuid("id").primaryKey(),
    source: text("source").notNull(),
    state: text("state").notNull(),
    fetched: integer("fetched").default(0).notNull(),
    upserted: integer("upserted").default(0).notNull(),
    deleted: integer("deleted").default(0).notNull(),
    logosQueued: integer("logos_queued").default(0).notNull(),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("connector_catalog_runs_source_started_idx").on(table.source, table.startedAt),
    check("connector_catalog_runs_counts_nonnegative_ck", sql`${table.fetched} >= 0 AND ${table.upserted} >= 0 AND ${table.deleted} >= 0 AND ${table.logosQueued} >= 0`),
  ],
);

export const connectorLogoAssets = connectors.table(
  "logo_assets",
  {
    id: uuid("id").primaryKey(),
    domain: text("domain").notNull(),
    r2Key: text("r2_key"),
    publicUrl: text("public_url"),
    contentType: text("content_type"),
    byteSize: bigint("byte_size", { mode: "number" }),
    sha256: text("sha256"),
    sourceUrl: text("source_url"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    unavailableAt: timestamp("unavailable_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("connector_logo_assets_domain_uq").on(table.domain),
    unique("connector_logo_assets_r2_key_uq").on(table.r2Key),
    check("connector_logo_assets_domain_normalized_ck", sql`${table.domain} = lower(${table.domain})`),
  ],
);

export const profileConnectors = connectors.table(
  "profile_connectors",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "restrict" }),
    connectorId: uuid("connector_id")
      .notNull()
      .references(() => connectorCatalogEntries.id, { onDelete: "restrict" }),
    revision: bigint("revision", { mode: "number" }).notNull(),
    releaseSelectionMode: text("release_selection_mode").notNull(),
    releaseSelectionValue: text("release_selection_value").notNull(),
    originDeviceId: uuid("origin_device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("profile_connectors_account_id_uq").on(table.accountId, table.id),
    uniqueIndex("profile_connectors_account_connector_active_uq")
      .on(table.accountId, table.connectorId)
      .where(sql`${table.deletedAt} is null`),
    check("profile_connectors_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const profileConnections = connectors.table(
  "profile_connections",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id").notNull(),
    profileConnectorId: uuid("profile_connector_id").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull(),
    endpointKey: text("endpoint_key").notNull(),
    accountLabel: text("account_label"),
    remoteSubject: text("remote_subject"),
    originDeviceId: uuid("origin_device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("profile_connections_account_id_uq").on(table.accountId, table.id),
    foreignKey({
      columns: [table.accountId, table.profileConnectorId],
      foreignColumns: [profileConnectors.accountId, profileConnectors.id],
      name: "profile_connections_connector_fk",
    }).onDelete("restrict"),
    check("profile_connections_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const profileChanges = connectors.table(
  "profile_changes",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "restrict" }),
    changeId: uuid("change_id").notNull(),
    originDeviceId: uuid("origin_device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    payloadSchemaVersion: integer("payload_schema_version").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    change: jsonb("change").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("profile_changes_account_change_uq").on(table.accountId, table.changeId),
    index("profile_changes_account_cursor_idx").on(table.accountId, table.id),
  ],
);
