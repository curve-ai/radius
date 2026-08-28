import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
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

export const agentIdentities = sqliteTable(
  "agent_identities",
  {
    id: text("id").primaryKey(),
    providerKey: text("provider_key").notNull(),
    agentKey: text("agent_key").notNull(),
    displayName: text("display_name").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("agent_identities_provider_agent_uq").on(
      table.providerKey,
      table.agentKey,
    ),
    check(
      "agent_identities_keys_nonempty",
      sql`length(trim(${table.providerKey})) > 0 and length(trim(${table.agentKey})) > 0`,
    ),
    check(
      "agent_identities_name_nonempty",
      sql`length(trim(${table.displayName})) > 0`,
    ),
  ],
);

export const agentReleases = sqliteTable(
  "agent_releases",
  {
    id: text("id").primaryKey(),
    agentId: id("agent_id").references(() => agentIdentities.id, {
      onDelete: "restrict",
    }),
    releaseVersion: text("release_version").notNull(),
    imageDigest: text("image_digest").notNull(),
    manifestSha256: text("manifest_sha256").notNull(),
    protocolKind: text("protocol_kind").notNull(),
    protocolVersion: integer("protocol_version").notNull(),
    verifiedAtMs: integer("verified_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("agent_releases_agent_version_uq").on(
      table.agentId,
      table.releaseVersion,
    ),
    uniqueIndex("agent_releases_image_digest_uq").on(table.imageDigest),
    check(
      "agent_releases_version_nonempty",
      sql`length(trim(${table.releaseVersion})) > 0`,
    ),
    check(
      "agent_releases_image_digest_valid",
      sql`length(${table.imageDigest}) = 71 and substr(${table.imageDigest}, 1, 7) = 'sha256:' and substr(${table.imageDigest}, 8) not glob '*[^0-9a-f]*'`,
    ),
    check(
      "agent_releases_manifest_hash_valid",
      sql`length(${table.manifestSha256}) = 64 and ${table.manifestSha256} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "agent_releases_protocol_version_positive",
      sql`${table.protocolVersion} > 0`,
    ),
  ],
);

export const agentInstallations = sqliteTable(
  "agent_installations",
  {
    id: text("id").primaryKey(),
    clientInstanceId: id("client_instance_id").references(
      () => clientInstances.id,
      { onDelete: "restrict" },
    ),
    agentId: id("agent_id").references(() => agentIdentities.id, {
      onDelete: "restrict",
    }),
    selectedReleaseId: id("selected_release_id").references(
      () => agentReleases.id,
      { onDelete: "restrict" },
    ),
    lifecycleState: text("lifecycle_state", {
      enum: ["staged", "ready", "disabled", "error"],
    }).notNull(),
    installedAtMs: integer("installed_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("agent_installations_client_agent_uq").on(
      table.clientInstanceId,
      table.agentId,
    ),
    uniqueIndex("agent_installations_id_client_uq").on(
      table.id,
      table.clientInstanceId,
    ),
    uniqueIndex("agent_installations_id_release_uq").on(
      table.id,
      table.selectedReleaseId,
    ),
    check(
      "agent_installations_state_valid",
      sql`${table.lifecycleState} in ('staged', 'ready', 'disabled', 'error')`,
    ),
  ],
);

export const authenticationAuthorities = sqliteTable(
  "authentication_authorities",
  {
    id: text("id").primaryKey(),
    authorityKey: text("authority_key").notNull(),
    purpose: text("purpose", {
      enum: ["vendor_identity", "model_provider", "router"],
    }).notNull(),
    canonicalIssuer: text("canonical_issuer"),
    displayName: text("display_name").notNull(),
  },
  (table) => [
    uniqueIndex("authentication_authorities_key_uq").on(table.authorityKey),
    uniqueIndex("authentication_authorities_issuer_uq")
      .on(table.canonicalIssuer)
      .where(sql`${table.canonicalIssuer} is not null`),
    check(
      "authentication_authorities_purpose_valid",
      sql`${table.purpose} in ('vendor_identity', 'model_provider', 'router')`,
    ),
  ],
);

export const authenticationAuthorityFlows = sqliteTable(
  "authentication_authority_flows",
  {
    id: text("id").primaryKey(),
    authorityId: id("authority_id").references(
      () => authenticationAuthorities.id,
      { onDelete: "restrict" },
    ),
    flowKey: text("flow_key").notNull(),
    flowKind: text("flow_kind", {
      enum: [
        "oidc_pkce",
        "oauth_pkce",
        "device_authorization",
        "api_key",
        "vendor_token_exchange",
        "provider_native_oauth",
      ],
    }).notNull(),
    publicClientId: text("public_client_id"),
    tokenAudience: text("token_audience"),
    deviceBindingSupported: integer("device_binding_supported", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
  },
  (table) => [
    uniqueIndex("authentication_authority_flows_authority_key_uq").on(
      table.authorityId,
      table.flowKey,
    ),
    check(
      "authentication_authority_flows_kind_valid",
      sql`${table.flowKind} in ('oidc_pkce', 'oauth_pkce', 'device_authorization', 'api_key', 'vendor_token_exchange', 'provider_native_oauth')`,
    ),
  ],
);

export const agentReleaseAuthRequirements = sqliteTable(
  "agent_release_auth_requirements",
  {
    id: text("id").primaryKey(),
    releaseId: id("release_id").references(() => agentReleases.id, {
      onDelete: "restrict",
    }),
    requirementKey: text("requirement_key").notNull(),
    authorityFlowId: id("authority_flow_id").references(
      () => authenticationAuthorityFlows.id,
      { onDelete: "restrict" },
    ),
    requirement: text("requirement", {
      enum: ["required", "optional"],
    }).notNull(),
    portability: text("portability", {
      enum: ["device_only", "profile_binding"],
    }).notNull(),
    runtimeDelivery: text("runtime_delivery", {
      enum: ["agent_state_adapter", "short_lived_token", "host_handle"],
    }).notNull(),
    manifestPosition: integer("manifest_position").notNull(),
  },
  (table) => [
    uniqueIndex("agent_release_auth_requirements_release_key_uq").on(
      table.releaseId,
      table.requirementKey,
    ),
    uniqueIndex("agent_release_auth_requirements_id_release_uq").on(
      table.id,
      table.releaseId,
    ),
    check(
      "agent_release_auth_requirements_requirement_valid",
      sql`${table.requirement} in ('required', 'optional')`,
    ),
    check(
      "agent_release_auth_requirements_portability_valid",
      sql`${table.portability} in ('device_only', 'profile_binding')`,
    ),
    check(
      "agent_release_auth_requirements_delivery_valid",
      sql`${table.runtimeDelivery} in ('agent_state_adapter', 'short_lived_token', 'host_handle')`,
    ),
    check(
      "agent_release_auth_requirements_position_nonnegative",
      sql`${table.manifestPosition} >= 0`,
    ),
  ],
);

export const agentReleaseAuthRequirementScopes = sqliteTable(
  "agent_release_auth_requirement_scopes",
  {
    requirementId: id("requirement_id").references(
      () => agentReleaseAuthRequirements.id,
      { onDelete: "restrict" },
    ),
    scope: text("scope").notNull(),
    requirement: text("requirement", {
      enum: ["required", "optional"],
    }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.requirementId, table.scope] }),
    check(
      "agent_release_auth_requirement_scopes_requirement_valid",
      sql`${table.requirement} in ('required', 'optional')`,
    ),
  ],
);

export const agentReleaseAuthRequirementCustodyKinds = sqliteTable(
  "agent_release_auth_requirement_custody_kinds",
  {
    requirementId: id("requirement_id").references(
      () => agentReleaseAuthRequirements.id,
      { onDelete: "restrict" },
    ),
    custodyKind: text("custody_kind", {
      enum: ["os_vault", "encrypted_agent_state", "managed_exchange", "none"],
    }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.requirementId, table.custodyKind] }),
    check(
      "agent_release_auth_requirement_custody_kind_valid",
      sql`${table.custodyKind} in ('os_vault', 'encrypted_agent_state', 'managed_exchange', 'none')`,
    ),
  ],
);

export const authenticationAccounts = sqliteTable(
  "authentication_accounts",
  {
    id: text("id").primaryKey(),
    clientInstanceId: id("client_instance_id").references(
      () => clientInstances.id,
      { onDelete: "restrict" },
    ),
    authorityFlowId: id("authority_flow_id").references(
      () => authenticationAuthorityFlows.id,
      { onDelete: "restrict" },
    ),
    custodyKind: text("custody_kind", {
      enum: ["os_vault", "encrypted_agent_state", "managed_exchange", "none"],
    }).notNull(),
    connectionState: text("connection_state", {
      enum: [
        "needs_authentication",
        "connected",
        "expired",
        "revoked",
        "disconnected",
        "error",
      ],
    }).notNull(),
    credentialRef: text("credential_ref"),
    remoteSubject: text("remote_subject"),
    tenantSubject: text("tenant_subject"),
    accountLabel: text("account_label"),
    expiresAtMs: timestamp("expires_at_ms"),
    connectedAtMs: timestamp("connected_at_ms"),
    disconnectedAtMs: timestamp("disconnected_at_ms"),
    revokedAtMs: timestamp("revoked_at_ms"),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("authentication_accounts_id_client_uq").on(
      table.id,
      table.clientInstanceId,
    ),
    index("authentication_accounts_client_authority_idx").on(
      table.clientInstanceId,
      table.authorityFlowId,
    ),
    check(
      "authentication_accounts_custody_kind_valid",
      sql`${table.custodyKind} in ('os_vault', 'encrypted_agent_state', 'managed_exchange', 'none')`,
    ),
    check(
      "authentication_accounts_state_valid",
      sql`${table.connectionState} in ('needs_authentication', 'connected', 'expired', 'revoked', 'disconnected', 'error')`,
    ),
    check(
      "authentication_accounts_connected_credential_valid",
      sql`${table.connectionState} <> 'connected' or ${table.custodyKind} in ('managed_exchange', 'none') or ${table.credentialRef} is not null`,
    ),
  ],
);

export const authenticationAccountGrantedScopes = sqliteTable(
  "authentication_account_granted_scopes",
  {
    accountId: id("account_id").references(() => authenticationAccounts.id, {
      onDelete: "restrict",
    }),
    scope: text("scope").notNull(),
    observedAtMs: integer("observed_at_ms").notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.scope] })],
);

export const authenticationAccountObservations = sqliteTable(
  "authentication_account_observations",
  {
    id: text("id").primaryKey(),
    accountId: id("account_id").references(() => authenticationAccounts.id, {
      onDelete: "restrict",
    }),
    eventKind: text("event_kind", {
      enum: [
        "connected",
        "refreshed",
        "expired",
        "revoked",
        "disconnected",
        "error",
      ],
    }).notNull(),
    resultCode: text("result_code").notNull(),
    entitlementRevision: text("entitlement_revision"),
    observedAtMs: integer("observed_at_ms").notNull(),
  },
  (table) => [
    index("authentication_account_observations_account_time_idx").on(
      table.accountId,
      table.observedAtMs,
    ),
    check(
      "authentication_account_observations_kind_valid",
      sql`${table.eventKind} in ('connected', 'refreshed', 'expired', 'revoked', 'disconnected', 'error')`,
    ),
  ],
);

export const agentAuthenticationBindings = sqliteTable(
  "agent_authentication_bindings",
  {
    id: text("id").primaryKey(),
    clientInstanceId: id("client_instance_id"),
    installationId: id("installation_id"),
    releaseId: id("release_id"),
    requirementId: id("requirement_id"),
    accountId: id("account_id"),
    boundAtMs: integer("bound_at_ms").notNull(),
    unboundAtMs: timestamp("unbound_at_ms"),
    unboundReason: text("unbound_reason"),
  },
  (table) => [
    foreignKey({
      columns: [table.installationId, table.clientInstanceId],
      foreignColumns: [
        agentInstallations.id,
        agentInstallations.clientInstanceId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.installationId, table.releaseId],
      foreignColumns: [
        agentInstallations.id,
        agentInstallations.selectedReleaseId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.requirementId, table.releaseId],
      foreignColumns: [
        agentReleaseAuthRequirements.id,
        agentReleaseAuthRequirements.releaseId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.accountId, table.clientInstanceId],
      foreignColumns: [
        authenticationAccounts.id,
        authenticationAccounts.clientInstanceId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("agent_authentication_bindings_active_requirement_uq")
      .on(table.installationId, table.requirementId)
      .where(sql`${table.unboundAtMs} is null`),
    check(
      "agent_authentication_bindings_unbound_reason_paired",
      sql`(${table.unboundAtMs} is null and ${table.unboundReason} is null) or (${table.unboundAtMs} is not null and ${table.unboundReason} is not null)`,
    ),
  ],
);
