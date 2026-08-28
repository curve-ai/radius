import { sql } from "drizzle-orm";
import {
  AnyPgColumn,
  bigint,
  check,
  foreignKey,
  index,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { radiusPlatform } from "./common.js";
import {
  developerTokens,
  organizationMemberships,
  organizations,
} from "./organizations.js";

export const agents = radiusPlatform.table(
  "agents",
  {
    id: uuid("agent_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    ref: text("agent_ref").notNull(),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    lifecycleState: text("lifecycle_state").notNull().default("active"),
    defaultEnvironmentId: uuid("default_environment_id").references(
      (): AnyPgColumn => agentEnvironments.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    index("agents_organization_state_idx").on(
      table.organizationId,
      table.lifecycleState,
    ),
    uniqueIndex("agents_ref_key").on(table.ref),
    unique("agents_identity_key").on(table.id, table.organizationId),
    uniqueIndex("agents_organization_slug_key").on(
      table.organizationId,
      table.slug,
    ),
    check(
      "agents_ref_check",
      sql`${table.ref} ~ '^agent_[A-Za-z0-9_-]{6,64}$'`,
    ),
    check("agents_slug_check", sql`${table.slug} ~ '^[a-z][a-z0-9-]{0,62}$'`),
    check(
      "agents_display_name_check",
      sql`char_length(btrim(${table.displayName})) BETWEEN 1 AND 120`,
    ),
    check(
      "agents_description_check",
      sql`${table.description} IS NULL OR char_length(${table.description}) <= 4000`,
    ),
    check(
      "agents_lifecycle_state_check",
      sql`${table.lifecycleState} IN ('active', 'archived')`,
    ),
    check(
      "agents_timestamps_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const agentEnvironments = radiusPlatform.table(
  "agent_environments",
  {
    id: uuid("environment_id").primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    lifecycleState: text("lifecycle_state").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    index("agent_environments_agent_state_idx").on(
      table.agentId,
      table.lifecycleState,
    ),
    uniqueIndex("agent_environments_agent_slug_key").on(
      table.agentId,
      table.slug,
    ),
    check(
      "agent_environments_slug_check",
      sql`${table.slug} ~ '^[a-z][a-z0-9-]{0,62}$'`,
    ),
    check(
      "agent_environments_display_name_check",
      sql`char_length(btrim(${table.displayName})) BETWEEN 1 AND 120`,
    ),
    check(
      "agent_environments_lifecycle_state_check",
      sql`${table.lifecycleState} IN ('active', 'archived')`,
    ),
    check(
      "agent_environments_timestamps_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const developerTokenAgents = radiusPlatform.table(
  "developer_token_agents",
  {
    developerTokenId: uuid("developer_token_id")
      .notNull()
      .references(() => developerTokens.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({ columns: [table.developerTokenId, table.agentId] }),
    index("developer_token_agents_agent_idx").on(table.agentId),
  ],
);

export const agentDeploymentUploads = radiusPlatform.table(
  "agent_deployment_uploads",
  {
    id: uuid("upload_id").primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    requestedEnvironmentId: uuid("requested_environment_id")
      .notNull()
      .references(() => agentEnvironments.id, { onDelete: "restrict" }),
    createdByMembershipId: uuid("created_by_membership_id").references(
      () => organizationMemberships.id,
      { onDelete: "restrict" },
    ),
    createdByDeveloperTokenId: uuid("created_by_developer_token_id").references(
      () => developerTokens.id,
      { onDelete: "restrict" },
    ),
    systemActorCode: text("system_actor_code"),
    buildDigest: text("build_digest").notNull(),
    bundleSha256: text("bundle_sha256").notNull(),
    minimumDesktopVersion: text("minimum_desktop_version").notNull(),
    runtimeProtocolVersion: smallint("runtime_protocol_version").notNull(),
    imageReference: text("image_reference").notNull(),
    secretReference: text("secret_reference"),
    uploadState: text("upload_state").notNull().default("prepared"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    index("agent_deployment_uploads_agent_created_idx").on(
      table.agentId,
      table.createdAt.desc(),
    ),
    index("agent_deployment_uploads_environment_idx").on(
      table.requestedEnvironmentId,
    ),
    index("agent_deployment_uploads_state_expiry_idx").on(
      table.uploadState,
      table.expiresAt,
    ),
    check(
      "agent_deployment_uploads_actor_check",
      sql`num_nonnulls(${table.createdByMembershipId}, ${table.createdByDeveloperTokenId}, ${table.systemActorCode}) = 1`,
    ),
    check(
      "agent_deployment_uploads_build_digest_check",
      sql`${table.buildDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "agent_deployment_uploads_bundle_digest_check",
      sql`${table.bundleSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "agent_deployment_uploads_system_actor_check",
      sql`${table.systemActorCode} IS NULL OR ${table.systemActorCode} ~ '^[a-z][a-z0-9_.:-]{1,127}$'`,
    ),
    check(
      "agent_deployment_uploads_desktop_version_check",
      sql`${table.minimumDesktopVersion} ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'`,
    ),
    check(
      "agent_deployment_uploads_runtime_protocol_check",
      sql`${table.runtimeProtocolVersion} > 0`,
    ),
    check(
      "agent_deployment_uploads_image_reference_check",
      sql`char_length(${table.imageReference}) BETWEEN 1 AND 1024`,
    ),
    check(
      "agent_deployment_uploads_secret_reference_check",
      sql`${table.secretReference} IS NULL OR char_length(${table.secretReference}) BETWEEN 1 AND 1024`,
    ),
    check(
      "agent_deployment_uploads_state_check",
      sql`${table.uploadState} IN ('prepared', 'finalized', 'expired', 'failed')`,
    ),
    check(
      "agent_deployment_uploads_finalized_check",
      sql`(${table.uploadState} = 'finalized') = (${table.finalizedAt} IS NOT NULL)`,
    ),
    check(
      "agent_deployment_uploads_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "agent_deployment_uploads_timestamps_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const agentDeployments = radiusPlatform.table(
  "agent_deployments",
  {
    id: uuid("agent_deployment_id").primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    uploadId: uuid("upload_id")
      .notNull()
      .references(() => agentDeploymentUploads.id, { onDelete: "restrict" }),
    version: text("version").notNull(),
    agentConfigVersion: smallint("agent_config_version").notNull(),
    agentManifestVersion: smallint("agent_manifest_version").notNull(),
    minimumDesktopVersion: text("minimum_desktop_version").notNull(),
    runtimeProtocolVersion: smallint("runtime_protocol_version").notNull(),
    imageDigest: text("image_digest").notNull(),
    sourceManifestDigest: text("source_manifest_digest").notNull(),
    bundleSha256: text("bundle_sha256").notNull(),
    verificationState: text("verification_state").notNull().default("pending"),
    verificationCompletedAt: timestamp("verification_completed_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    index("agent_deployments_agent_created_idx").on(
      table.agentId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("agent_deployments_state_idx").on(table.verificationState),
    uniqueIndex("agent_deployments_agent_version_key").on(
      table.agentId,
      table.version,
    ),
    unique("agent_deployments_identity_key").on(table.id, table.agentId),
    uniqueIndex("agent_deployments_upload_key").on(table.uploadId),
    check(
      "agent_deployments_image_digest_check",
      sql`${table.imageDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "agent_deployments_source_manifest_digest_check",
      sql`${table.sourceManifestDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "agent_deployments_version_check",
      sql`char_length(btrim(${table.version})) BETWEEN 1 AND 120`,
    ),
    check(
      "agent_deployments_config_version_check",
      sql`${table.agentConfigVersion} > 0`,
    ),
    check(
      "agent_deployments_manifest_version_check",
      sql`${table.agentManifestVersion} > 0`,
    ),
    check(
      "agent_deployments_desktop_version_check",
      sql`${table.minimumDesktopVersion} ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'`,
    ),
    check(
      "agent_deployments_runtime_protocol_check",
      sql`${table.runtimeProtocolVersion} > 0`,
    ),
    check(
      "agent_deployments_bundle_digest_check",
      sql`${table.bundleSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "agent_deployments_verification_state_check",
      sql`${table.verificationState} IN ('pending', 'verified', 'quarantined', 'revoked')`,
    ),
    check(
      "agent_deployments_verification_time_check",
      sql`(${table.verificationState} = 'pending' AND ${table.verificationCompletedAt} IS NULL) OR (${table.verificationState} IN ('verified', 'quarantined', 'revoked') AND ${table.verificationCompletedAt} IS NOT NULL)`,
    ),
  ],
);

export const agentDeploymentArtifacts = radiusPlatform.table(
  "agent_deployment_artifacts",
  {
    id: uuid("agent_deployment_artifact_id").primaryKey(),
    agentDeploymentId: uuid("agent_deployment_id")
      .notNull()
      .references(() => agentDeployments.id, { onDelete: "restrict" }),
    artifactKind: text("artifact_kind").notNull(),
    providerReference: text("provider_reference").notNull(),
    digest: text("digest").notNull(),
    mediaType: text("media_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    operatingSystem: text("operating_system"),
    architecture: text("architecture"),
    variant: text("variant"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    index("agent_deployment_artifacts_agent_deployment_idx").on(
      table.agentDeploymentId,
    ),
    index("agent_deployment_artifacts_digest_idx").on(table.digest),
    uniqueIndex("agent_deployment_artifacts_slot_key").on(
      table.agentDeploymentId,
      table.artifactKind,
      table.digest,
      table.operatingSystem,
      table.architecture,
      table.variant,
    ),
    check(
      "agent_deployment_artifacts_kind_check",
      sql`${table.artifactKind} IN ('oci_manifest', 'source_bundle', 'sbom', 'provenance', 'signature', 'notices')`,
    ),
    check(
      "agent_deployment_artifacts_reference_check",
      sql`char_length(${table.providerReference}) BETWEEN 1 AND 2048`,
    ),
    check(
      "agent_deployment_artifacts_digest_check",
      sql`${table.digest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "agent_deployment_artifacts_media_type_check",
      sql`char_length(${table.mediaType}) BETWEEN 1 AND 255`,
    ),
    check("agent_deployment_artifacts_size_check", sql`${table.byteSize} >= 0`),
    check(
      "agent_deployment_artifacts_platform_check",
      sql`(${table.operatingSystem} IS NULL AND ${table.architecture} IS NULL AND ${table.variant} IS NULL) OR (${table.operatingSystem} IS NOT NULL AND ${table.architecture} IS NOT NULL AND char_length(${table.operatingSystem}) BETWEEN 1 AND 64 AND char_length(${table.architecture}) BETWEEN 1 AND 64 AND (${table.variant} IS NULL OR char_length(${table.variant}) BETWEEN 1 AND 64))`,
    ),
  ],
);

export const agentEnvironmentRevisions = radiusPlatform.table(
  "agent_environment_revisions",
  {
    id: uuid("agent_environment_revision_id").primaryKey(),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => agentEnvironments.id, { onDelete: "restrict" }),
    revision: bigint("revision", { mode: "number" }).notNull(),
    actionCode: text("action_code").notNull(),
    agentDeploymentId: uuid("agent_deployment_id").references(
      () => agentDeployments.id,
      { onDelete: "restrict" },
    ),
    actorMembershipId: uuid("actor_membership_id").references(
      () => organizationMemberships.id,
      { onDelete: "restrict" },
    ),
    actorDeveloperTokenId: uuid("actor_developer_token_id").references(
      () => developerTokens.id,
      { onDelete: "restrict" },
    ),
    systemActorCode: text("system_actor_code"),
    reason: text("reason"),
    requestId: uuid("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    index("agent_environment_revisions_environment_created_idx").on(
      table.environmentId,
      table.revision.desc(),
    ),
    index("agent_environment_revisions_agent_deployment_idx")
      .on(table.agentDeploymentId)
      .where(sql`${table.agentDeploymentId} IS NOT NULL`),
    uniqueIndex("agent_environment_revisions_environment_revision_key").on(
      table.environmentId,
      table.revision,
    ),
    check(
      "agent_environment_revisions_revision_check",
      sql`${table.revision} > 0`,
    ),
    check(
      "agent_environment_revisions_action_check",
      sql`${table.actionCode} IN ('deploy', 'promote', 'rollback', 'revoke')`,
    ),
    check(
      "agent_environment_revisions_deployment_action_check",
      sql`(${table.actionCode} = 'revoke' AND ${table.agentDeploymentId} IS NULL) OR (${table.actionCode} <> 'revoke' AND ${table.agentDeploymentId} IS NOT NULL)`,
    ),
    check(
      "agent_environment_revisions_actor_check",
      sql`num_nonnulls(${table.actorMembershipId}, ${table.actorDeveloperTokenId}, ${table.systemActorCode}) = 1`,
    ),
    check(
      "agent_environment_revisions_system_actor_check",
      sql`${table.systemActorCode} IS NULL OR ${table.systemActorCode} ~ '^[a-z][a-z0-9_.:-]{1,127}$'`,
    ),
    check(
      "agent_environment_revisions_reason_check",
      sql`${table.reason} IS NULL OR char_length(${table.reason}) <= 2000`,
    ),
  ],
);
