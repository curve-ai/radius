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
const { clientInstances } = workspace;

export const capabilityContracts = sqliteTable(
  "capability_contracts",
  {
    id: text("id").primaryKey(),
    capabilityKey: text("capability_key").notNull(),
    contractVersion: integer("contract_version").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description").notNull(),
  },
  (table) => [
    uniqueIndex("capability_contracts_key_version_uq").on(
      table.capabilityKey,
      table.contractVersion,
    ),
    check(
      "capability_contracts_key_nonempty",
      sql`length(trim(${table.capabilityKey})) > 0`,
    ),
    check(
      "capability_contracts_version_positive",
      sql`${table.contractVersion} > 0`,
    ),
  ],
);

export const capabilityOperations = sqliteTable(
  "capability_operations",
  {
    id: text("id").primaryKey(),
    contractId: id("contract_id").references(() => capabilityContracts.id, {
      onDelete: "restrict",
    }),
    operationName: text("operation_name").notNull(),
    inputSchemaId: text("input_schema_id").notNull(),
    inputSchemaVersion: integer("input_schema_version").notNull(),
    outputSchemaId: text("output_schema_id").notNull(),
    outputSchemaVersion: integer("output_schema_version").notNull(),
    riskClass: text("risk_class", {
      enum: ["read", "write", "external_side_effect", "privileged"],
    }).notNull(),
    approvalEligible: integer("approval_eligible", { mode: "boolean" })
      .notNull()
      .default(true),
  },
  (table) => [
    uniqueIndex("capability_operations_contract_name_uq").on(
      table.contractId,
      table.operationName,
    ),
    check(
      "capability_operations_name_nonempty",
      sql`length(trim(${table.operationName})) > 0`,
    ),
    check(
      "capability_operations_schema_versions_positive",
      sql`${table.inputSchemaVersion} > 0 and ${table.outputSchemaVersion} > 0`,
    ),
    check(
      "capability_operations_risk_valid",
      sql`${table.riskClass} in ('read', 'write', 'external_side_effect', 'privileged')`,
    ),
  ],
);

export const connectorIdentities = sqliteTable(
  "connector_identities",
  {
    id: text("id").primaryKey(),
    publisherKey: text("publisher_key").notNull(),
    connectorKey: text("connector_key").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description").notNull(),
    catalogSource: text("catalog_source"),
    catalogExternalId: text("catalog_external_id"),
    domain: text("domain"),
    logoUrl: text("logo_url"),
  },
  (table) => [
    uniqueIndex("connector_identities_publisher_key_uq").on(
      table.publisherKey,
      table.connectorKey,
    ),
    uniqueIndex("connector_identities_catalog_uq")
      .on(table.catalogSource, table.catalogExternalId)
      .where(sql`${table.catalogSource} is not null`),
    check(
      "connector_identities_keys_nonempty",
      sql`length(trim(${table.publisherKey})) > 0 and length(trim(${table.connectorKey})) > 0`,
    ),
  ],
);

export const connectorReleases = sqliteTable(
  "connector_releases",
  {
    id: text("id").primaryKey(),
    connectorId: id("connector_id").references(() => connectorIdentities.id, {
      onDelete: "restrict",
    }),
    version: text("version").notNull(),
    manifestSha256: text("manifest_sha256").notNull(),
    minimumHostVersion: text("minimum_host_version").notNull(),
    publishedAtMs: integer("published_at_ms").notNull(),
    revokedAtMs: timestamp("revoked_at_ms"),
    revocationReason: text("revocation_reason"),
  },
  (table) => [
    uniqueIndex("connector_releases_connector_version_uq").on(
      table.connectorId,
      table.version,
    ),
    uniqueIndex("connector_releases_manifest_uq").on(table.manifestSha256),
    check(
      "connector_releases_manifest_hash_valid",
      sql`length(${table.manifestSha256}) = 64 and ${table.manifestSha256} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "connector_releases_revocation_paired",
      sql`(${table.revokedAtMs} is null and ${table.revocationReason} is null) or (${table.revokedAtMs} is not null and length(trim(${table.revocationReason})) > 0)`,
    ),
  ],
);

export const connectorReleaseEndpoints = sqliteTable(
  "connector_release_endpoints",
  {
    id: text("id").primaryKey(),
    releaseId: id("release_id").references(() => connectorReleases.id, {
      onDelete: "restrict",
    }),
    endpointKey: text("endpoint_key").notNull(),
    transport: text("transport", { enum: ["streamable_http"] }).notNull(),
    endpointUrl: text("endpoint_url").notNull(),
    authentication: text("authentication", {
      enum: ["none", "oauth", "bearer"],
    }).notNull(),
  },
  (table) => [
    uniqueIndex("connector_release_endpoints_key_uq").on(
      table.releaseId,
      table.endpointKey,
    ),
    check(
      "connector_release_endpoints_transport_valid",
      sql`${table.transport} = 'streamable_http'`,
    ),
    check(
      "connector_release_endpoints_auth_valid",
      sql`${table.authentication} in ('none', 'oauth', 'bearer')`,
    ),
  ],
);

export const connectorReleaseCapabilityMappings = sqliteTable(
  "connector_release_capability_mappings",
  {
    releaseId: id("release_id").references(() => connectorReleases.id, {
      onDelete: "restrict",
    }),
    endpointId: id("endpoint_id").references(
      () => connectorReleaseEndpoints.id,
      { onDelete: "restrict" },
    ),
    operationId: id("operation_id").references(() => capabilityOperations.id, {
      onDelete: "restrict",
    }),
    nativeToolName: text("native_tool_name").notNull(),
    inputSchemaSha256: text("input_schema_sha256").notNull(),
    outputSchemaSha256: text("output_schema_sha256"),
  },
  (table) => [
    primaryKey({
      columns: [table.releaseId, table.endpointId, table.operationId],
    }),
    check(
      "connector_release_mappings_input_hash_valid",
      sql`length(${table.inputSchemaSha256}) = 64 and ${table.inputSchemaSha256} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "connector_release_mappings_output_hash_valid",
      sql`${table.outputSchemaSha256} is null or (length(${table.outputSchemaSha256}) = 64 and ${table.outputSchemaSha256} not glob '*[^0-9a-f]*')`,
    ),
  ],
);

export const profileConnectors = sqliteTable(
  "profile_connectors",
  {
    id: text("id").primaryKey(),
    profileSubject: text("profile_subject").notNull(),
    connectorId: id("connector_id").references(() => connectorIdentities.id, {
      onDelete: "restrict",
    }),
    revision: integer("revision").notNull(),
    releaseSelectionMode: text("release_selection_mode", {
      enum: ["exact", "channel"],
    }).notNull(),
    releaseSelectionValue: text("release_selection_value").notNull(),
    originClientInstanceId: id("origin_client_instance_id").references(
      () => clientInstances.id,
      { onDelete: "restrict" },
    ),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
    deletedAtMs: timestamp("deleted_at_ms"),
  },
  (table) => [
    uniqueIndex("profile_connectors_subject_connector_uq").on(
      table.profileSubject,
      table.connectorId,
    ),
    check("profile_connectors_revision_positive", sql`${table.revision} > 0`),
    check(
      "profile_connectors_selection_mode_valid",
      sql`${table.releaseSelectionMode} in ('exact', 'channel')`,
    ),
  ],
);

export const profileConnectorConnections = sqliteTable(
  "profile_connector_connections",
  {
    id: text("id").primaryKey(),
    profileConnectorId: id("profile_connector_id").references(
      () => profileConnectors.id,
      { onDelete: "restrict" },
    ),
    revision: integer("revision").notNull(),
    endpointKey: text("endpoint_key").notNull(),
    accountLabel: text("account_label"),
    remoteSubject: text("remote_subject"),
    originClientInstanceId: id("origin_client_instance_id").references(
      () => clientInstances.id,
      { onDelete: "restrict" },
    ),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
    deletedAtMs: timestamp("deleted_at_ms"),
  },
  (table) => [
    check(
      "profile_connector_connections_revision_positive",
      sql`${table.revision} > 0`,
    ),
    index("profile_connector_connections_connector_idx").on(
      table.profileConnectorId,
    ),
  ],
);

export const connectorInstallations = sqliteTable(
  "connector_installations",
  {
    id: text("id").primaryKey(),
    clientInstanceId: id("client_instance_id").references(
      () => clientInstances.id,
      { onDelete: "restrict" },
    ),
    connectorId: id("connector_id").references(() => connectorIdentities.id, {
      onDelete: "restrict",
    }),
    selectedReleaseId: id("selected_release_id").references(
      () => connectorReleases.id,
      { onDelete: "restrict" },
    ),
    profileConnectorId: text("profile_connector_id").references(
      () => profileConnectors.id,
      { onDelete: "restrict" },
    ),
    appliedProfileRevision: integer("applied_profile_revision"),
    lifecycleState: text("lifecycle_state", {
      enum: ["staged", "ready", "disconnected", "deleted", "error"],
    }).notNull(),
    installedAtMs: integer("installed_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("connector_installations_client_connector_uq").on(
      table.clientInstanceId,
      table.connectorId,
    ),
    check(
      "connector_installations_state_valid",
      sql`${table.lifecycleState} in ('staged', 'ready', 'disconnected', 'deleted', 'error')`,
    ),
    check(
      "connector_installations_profile_revision_paired",
      sql`(${table.profileConnectorId} is null and ${table.appliedProfileRevision} is null) or (${table.profileConnectorId} is not null and ${table.appliedProfileRevision} > 0)`,
    ),
  ],
);

export const toolProviders = sqliteTable(
  "tool_providers",
  {
    id: text("id").primaryKey(),
    clientInstanceId: id("client_instance_id").references(
      () => clientInstances.id,
      { onDelete: "restrict" },
    ),
    installationId: id("installation_id").references(
      () => connectorInstallations.id,
      { onDelete: "restrict" },
    ),
    endpointId: id("endpoint_id").references(
      () => connectorReleaseEndpoints.id,
      { onDelete: "restrict" },
    ),
    profileConnectionId: text("profile_connection_id").references(
      () => profileConnectorConnections.id,
      { onDelete: "restrict" },
    ),
    appliedProfileRevision: integer("applied_profile_revision"),
    providerKey: text("provider_key").notNull(),
    label: text("label").notNull(),
    credentialRef: text("credential_ref"),
    connectionState: text("connection_state", {
      enum: ["needs_authentication", "connected", "disconnected", "error"],
    }).notNull(),
    connectedAtMs: timestamp("connected_at_ms"),
    disconnectedAtMs: timestamp("disconnected_at_ms"),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("tool_providers_client_key_uq").on(
      table.clientInstanceId,
      table.providerKey,
    ),
    check(
      "tool_providers_state_valid",
      sql`${table.connectionState} in ('needs_authentication', 'connected', 'disconnected', 'error')`,
    ),
    check(
      "tool_providers_profile_revision_paired",
      sql`(${table.profileConnectionId} is null and ${table.appliedProfileRevision} is null) or (${table.profileConnectionId} is not null and ${table.appliedProfileRevision} > 0)`,
    ),
    check(
      "tool_providers_credential_connected",
      sql`${table.connectionState} <> 'connected' or ${table.credentialRef} is not null or ${table.connectedAtMs} is not null`,
    ),
  ],
);

export const toolBindings = sqliteTable(
  "tool_bindings",
  {
    id: text("id").primaryKey(),
    providerId: id("provider_id").references(() => toolProviders.id, {
      onDelete: "restrict",
    }),
    operationId: id("operation_id").references(() => capabilityOperations.id, {
      onDelete: "restrict",
    }),
    nativeToolName: text("native_tool_name").notNull(),
    inputSchemaSha256: text("input_schema_sha256").notNull(),
    outputSchemaSha256: text("output_schema_sha256"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    discoveredAtMs: integer("discovered_at_ms").notNull(),
    disabledAtMs: timestamp("disabled_at_ms"),
  },
  (table) => [
    uniqueIndex("tool_bindings_provider_tool_schema_uq").on(
      table.providerId,
      table.nativeToolName,
      table.inputSchemaSha256,
    ),
    check(
      "tool_bindings_input_hash_valid",
      sql`length(${table.inputSchemaSha256}) = 64 and ${table.inputSchemaSha256} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "tool_bindings_output_hash_valid",
      sql`${table.outputSchemaSha256} is null or (length(${table.outputSchemaSha256}) = 64 and ${table.outputSchemaSha256} not glob '*[^0-9a-f]*')`,
    ),
  ],
);
