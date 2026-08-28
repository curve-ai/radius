import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { agentDeployments, agents } from "./agents.js";
import { radiusPlatform } from "./common.js";
import { organizationMemberships, organizations } from "./organizations.js";

export const physicalDevices = radiusPlatform.table(
  "physical_devices",
  {
    id: uuid("physical_device_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    assignedMembershipId: uuid("assigned_membership_id"),
    deviceFingerprint: text("device_fingerprint").notNull(),
    displayName: text("display_name").notNull(),
    assetTag: text("asset_tag"),
    platform: text("platform").notNull(),
    architecture: text("architecture").notNull(),
    lifecycleState: text("lifecycle_state").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    foreignKey({
      name: "physical_devices_assignment_fk",
      columns: [table.assignedMembershipId, table.organizationId],
      foreignColumns: [
        organizationMemberships.id,
        organizationMemberships.organizationId,
      ],
    }).onDelete("restrict"),
    index("physical_devices_organization_state_idx").on(
      table.organizationId,
      table.lifecycleState,
    ),
    index("physical_devices_membership_idx")
      .on(table.assignedMembershipId)
      .where(sql`${table.assignedMembershipId} IS NOT NULL`),
    unique("physical_devices_identity_key").on(table.id, table.organizationId),
    uniqueIndex("physical_devices_fingerprint_key").on(
      table.organizationId,
      table.deviceFingerprint,
    ),
    uniqueIndex("physical_devices_asset_tag_key").on(
      table.organizationId,
      table.assetTag,
    ),
    check(
      "physical_devices_fingerprint_check",
      sql`${table.deviceFingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "physical_devices_display_name_check",
      sql`char_length(btrim(${table.displayName})) BETWEEN 1 AND 120`,
    ),
    check(
      "physical_devices_asset_tag_check",
      sql`${table.assetTag} IS NULL OR char_length(btrim(${table.assetTag})) BETWEEN 1 AND 120`,
    ),
    check(
      "physical_devices_platform_check",
      sql`char_length(btrim(${table.platform})) BETWEEN 1 AND 64`,
    ),
    check(
      "physical_devices_architecture_check",
      sql`char_length(btrim(${table.architecture})) BETWEEN 1 AND 64`,
    ),
    check(
      "physical_devices_lifecycle_check",
      sql`${table.lifecycleState} IN ('active', 'suspended', 'retired', 'lost')`,
    ),
    check(
      "physical_devices_timestamps_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const clientInstallations = radiusPlatform.table(
  "client_installations",
  {
    id: uuid("client_installation_id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    physicalDeviceId: uuid("physical_device_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    clientInstanceId: uuid("client_instance_id").notNull(),
    lifecycleState: text("lifecycle_state").notNull().default("active"),
    installedAt: timestamp("installed_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    foreignKey({
      name: "client_installations_device_fk",
      columns: [table.physicalDeviceId, table.organizationId],
      foreignColumns: [physicalDevices.id, physicalDevices.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "client_installations_membership_fk",
      columns: [table.membershipId, table.organizationId],
      foreignColumns: [
        organizationMemberships.id,
        organizationMemberships.organizationId,
      ],
    }).onDelete("restrict"),
    index("client_installations_device_state_idx").on(
      table.physicalDeviceId,
      table.lifecycleState,
    ),
    index("client_installations_membership_state_idx").on(
      table.membershipId,
      table.lifecycleState,
    ),
    uniqueIndex("client_installations_client_key").on(table.clientInstanceId),
    unique("client_installations_identity_key").on(
      table.id,
      table.organizationId,
    ),
    check(
      "client_installations_lifecycle_check",
      sql`${table.lifecycleState} IN ('active', 'suspended', 'removed')`,
    ),
    check(
      "client_installations_timestamps_check",
      sql`${table.createdAt} >= ${table.installedAt} AND ${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const clientInstallationObservations = radiusPlatform.table(
  "client_installation_observations",
  {
    id: uuid("client_installation_observation_id").primaryKey(),
    clientInstallationId: uuid("client_installation_id")
      .notNull()
      .references(() => clientInstallations.id, { onDelete: "restrict" }),
    clientEventId: uuid("client_event_id").notNull(),
    schemaVersion: smallint("schema_version").notNull().default(1),
    desktopVersion: text("desktop_version").notNull(),
    runtimeVersion: text("runtime_version").notNull(),
    runtimeProtocolVersion: smallint("runtime_protocol_version").notNull(),
    observationState: text("observation_state").notNull(),
    errorCode: text("error_code"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    index("client_installation_observations_latest_idx").on(
      table.clientInstallationId,
      table.observedAt.desc(),
      table.id.desc(),
    ),
    uniqueIndex("client_installation_observations_event_key").on(
      table.clientInstallationId,
      table.clientEventId,
    ),
    check(
      "client_installation_observations_schema_check",
      sql`${table.schemaVersion} > 0`,
    ),
    check(
      "client_installation_observations_desktop_version_check",
      sql`char_length(btrim(${table.desktopVersion})) BETWEEN 1 AND 120`,
    ),
    check(
      "client_installation_observations_runtime_version_check",
      sql`char_length(btrim(${table.runtimeVersion})) BETWEEN 1 AND 120`,
    ),
    check(
      "client_installation_observations_protocol_check",
      sql`${table.runtimeProtocolVersion} > 0`,
    ),
    check(
      "client_installation_observations_state_check",
      sql`${table.observationState} IN ('ready', 'degraded', 'update_required', 'error')`,
    ),
    check(
      "client_installation_observations_error_check",
      sql`(${table.observationState} = 'error' AND ${table.errorCode} ~ '^[A-Z][A-Z0-9_]{1,127}$') OR (${table.observationState} <> 'error' AND ${table.errorCode} IS NULL)`,
    ),
  ],
);

export const agentInstallations = radiusPlatform.table(
  "agent_installations",
  {
    id: uuid("agent_installation_id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    clientInstallationId: uuid("client_installation_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    lifecycleState: text("lifecycle_state").notNull().default("active"),
    installedAt: timestamp("installed_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    foreignKey({
      name: "agent_installations_client_fk",
      columns: [table.clientInstallationId, table.organizationId],
      foreignColumns: [
        clientInstallations.id,
        clientInstallations.organizationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "agent_installations_agent_fk",
      columns: [table.agentId, table.organizationId],
      foreignColumns: [agents.id, agents.organizationId],
    }).onDelete("restrict"),
    index("agent_installations_agent_state_idx").on(
      table.agentId,
      table.lifecycleState,
    ),
    uniqueIndex("agent_installations_client_agent_key").on(
      table.clientInstallationId,
      table.agentId,
    ),
    unique("agent_installations_identity_key").on(table.id, table.agentId),
    unique("agent_installations_organization_key").on(
      table.id,
      table.organizationId,
    ),
    check(
      "agent_installations_lifecycle_check",
      sql`${table.lifecycleState} IN ('active', 'removed')`,
    ),
    check(
      "agent_installations_timestamps_check",
      sql`${table.updatedAt} >= ${table.installedAt}`,
    ),
  ],
);

export const agentInstallationObservations = radiusPlatform.table(
  "agent_installation_observations",
  {
    id: uuid("agent_installation_observation_id").primaryKey(),
    agentInstallationId: uuid("agent_installation_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    agentDeploymentId: uuid("agent_deployment_id").notNull(),
    clientEventId: uuid("client_event_id").notNull(),
    schemaVersion: smallint("schema_version").notNull().default(1),
    observationState: text("observation_state").notNull(),
    errorCode: text("error_code"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    foreignKey({
      name: "agent_installation_observations_installation_fk",
      columns: [table.agentInstallationId, table.agentId],
      foreignColumns: [agentInstallations.id, agentInstallations.agentId],
    }).onDelete("restrict"),
    foreignKey({
      name: "agent_installation_observations_deployment_fk",
      columns: [table.agentDeploymentId, table.agentId],
      foreignColumns: [agentDeployments.id, agentDeployments.agentId],
    }).onDelete("restrict"),
    index("agent_installation_observations_latest_idx").on(
      table.agentInstallationId,
      table.observedAt.desc(),
      table.id.desc(),
    ),
    index("agent_installation_observations_deployment_idx").on(
      table.agentDeploymentId,
    ),
    uniqueIndex("agent_installation_observations_event_key").on(
      table.agentInstallationId,
      table.clientEventId,
    ),
    check(
      "agent_installation_observations_schema_check",
      sql`${table.schemaVersion} > 0`,
    ),
    check(
      "agent_installation_observations_state_check",
      sql`${table.observationState} IN ('installing', 'ready', 'failed', 'retained', 'removed', 'blocked_incompatible')`,
    ),
    check(
      "agent_installation_observations_error_check",
      sql`(${table.observationState} IN ('failed', 'blocked_incompatible') AND ${table.errorCode} ~ '^[A-Z][A-Z0-9_]{1,127}$') OR (${table.observationState} NOT IN ('failed', 'blocked_incompatible') AND ${table.errorCode} IS NULL)`,
    ),
  ],
);
