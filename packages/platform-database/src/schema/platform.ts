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
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./auth.js";

const platform = pgSchema("platform");

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const platformAccounts = platform.table("accounts", {
  id: uuid("id").primaryKey(),
  authUserId: text("auth_user_id")
    .notNull()
    .unique()
    .references(() => authUsers.id, { onDelete: "restrict" }),
  status: text("status").default("active").notNull(),
  ...timestamps,
});

export const organizations = platform.table(
  "organizations",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").default("active").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("organizations_slug_uq").on(table.slug),
    unique("organizations_id_tenant_uq").on(table.id, table.slug),
    check("organizations_slug_normalized_ck", sql`${table.slug} = lower(${table.slug})`),
    check("organizations_slug_format_ck", sql`${table.slug} ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'`),
  ],
);

export const organizationDomains = platform.table(
  "organization_domains",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    hostname: text("hostname").notNull(),
    domainKind: text("domain_kind").notNull(),
    status: text("status").default("pending").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("organization_domains_hostname_uq").on(table.hostname),
    index("organization_domains_organization_idx").on(table.organizationId),
    check("organization_domains_hostname_normalized_ck", sql`${table.hostname} = lower(${table.hostname})`),
  ],
);

export const organizationMemberships = platform.table(
  "organization_memberships",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "restrict" }),
    status: text("status").default("active").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("organization_memberships_org_account_uq").on(table.organizationId, table.accountId),
    unique("organization_memberships_org_id_uq").on(table.organizationId, table.id),
    index("organization_memberships_account_idx").on(table.accountId),
  ],
);

export const roleDefinitions = platform.table(
  "role_definitions",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull(),
    displayName: text("display_name").notNull(),
    builtIn: boolean("built_in").default(false).notNull(),
    ...timestamps,
  },
  (table) => [unique("role_definitions_key_uq").on(table.key)],
);

export const membershipRoles = platform.table(
  "membership_roles",
  {
    organizationId: uuid("organization_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roleDefinitions.id, { onDelete: "restrict" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.membershipId, table.roleId] }),
    foreignKey({
      columns: [table.organizationId, table.membershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
      name: "membership_roles_membership_fk",
    }).onDelete("cascade"),
  ],
);

export const organizationGroups = platform.table(
  "organization_groups",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("organization_groups_org_name_uq").on(table.organizationId, table.name),
    unique("organization_groups_org_id_uq").on(table.organizationId, table.id),
  ],
);

export const groupMemberships = platform.table(
  "group_memberships",
  {
    organizationId: uuid("organization_id").notNull(),
    groupId: uuid("group_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.membershipId] }),
    foreignKey({
      columns: [table.organizationId, table.groupId],
      foreignColumns: [organizationGroups.organizationId, organizationGroups.id],
      name: "group_memberships_group_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.membershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
      name: "group_memberships_membership_fk",
    }).onDelete("cascade"),
  ],
);

export const projects = platform.table(
  "projects",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    status: text("status").default("active").notNull(),
    revision: bigint("revision", { mode: "number" }).default(1).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("projects_org_slug_uq").on(table.organizationId, table.slug),
    unique("projects_org_id_uq").on(table.organizationId, table.id),
    check("projects_slug_normalized_ck", sql`${table.slug} = lower(${table.slug})`),
    check("projects_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const environments = platform.table(
  "environments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    key: text("key").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").default("active").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("environments_project_key_uq").on(table.projectId, table.key),
    unique("environments_org_id_uq").on(table.organizationId, table.id),
    unique("environments_org_id_project_uq").on(table.organizationId, table.id, table.projectId),
    foreignKey({
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
      name: "environments_project_fk",
    }).onDelete("restrict"),
    check("environments_key_normalized_ck", sql`${table.key} = lower(${table.key})`),
  ],
);

export const releases = platform.table(
  "releases",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    version: text("version").notNull(),
    contentDigest: text("content_digest").notNull(),
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
    contractVersion: text("contract_version").notNull(),
    createdByMembershipId: uuid("created_by_membership_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("releases_project_version_uq").on(table.projectId, table.version),
    unique("releases_project_digest_uq").on(table.projectId, table.contentDigest),
    unique("releases_org_id_uq").on(table.organizationId, table.id),
    unique("releases_org_id_project_uq").on(table.organizationId, table.id, table.projectId),
    foreignKey({
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
      name: "releases_project_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.createdByMembershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
      name: "releases_creator_fk",
    }).onDelete("restrict"),
  ],
);

export const releaseRevocations = platform.table(
  "release_revocations",
  {
    releaseId: uuid("release_id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    revokedByMembershipId: uuid("revoked_by_membership_id").notNull(),
    reason: text("reason").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.releaseId],
      foreignColumns: [releases.organizationId, releases.id],
      name: "release_revocations_release_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.revokedByMembershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
      name: "release_revocations_membership_fk",
    }).onDelete("restrict"),
  ],
);

export const releaseArtifacts = platform.table(
  "release_artifacts",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    artifactKind: text("artifact_kind").notNull(),
    digestAlgorithm: text("digest_algorithm").notNull(),
    digest: text("digest").notNull(),
    mediaType: text("media_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    storageProvider: text("storage_provider").notNull(),
    objectKey: text("object_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("release_artifacts_release_kind_uq").on(table.releaseId, table.artifactKind),
    unique("release_artifacts_digest_uq").on(table.digestAlgorithm, table.digest),
    check("release_artifacts_byte_size_nonnegative_ck", sql`${table.byteSize} >= 0`),
    foreignKey({
      columns: [table.organizationId, table.releaseId],
      foreignColumns: [releases.organizationId, releases.id],
      name: "release_artifacts_release_tenant_fk",
    }).onDelete("restrict"),
  ],
);

export const deployments = platform.table(
  "deployments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    revision: bigint("revision", { mode: "number" }).default(1).notNull(),
    updatedByMembershipId: uuid("updated_by_membership_id").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("deployments_environment_uq").on(table.environmentId),
    unique("deployments_org_id_uq").on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.environmentId, table.projectId],
      foreignColumns: [environments.organizationId, environments.id, environments.projectId],
      name: "deployments_environment_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.releaseId, table.projectId],
      foreignColumns: [releases.organizationId, releases.id, releases.projectId],
      name: "deployments_release_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.updatedByMembershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
      name: "deployments_updater_fk",
    }).onDelete("restrict"),
    check("deployments_revision_positive_ck", sql`${table.revision} > 0`),
  ],
);

export const deploymentRevisions = platform.table(
  "deployment_revisions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    deploymentId: uuid("deployment_id").notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull(),
    action: text("action").notNull(),
    changedByMembershipId: uuid("changed_by_membership_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("deployment_revisions_deployment_revision_uq").on(table.deploymentId, table.revision),
    foreignKey({
      columns: [table.organizationId, table.deploymentId],
      foreignColumns: [deployments.organizationId, deployments.id],
      name: "deployment_revisions_deployment_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.environmentId, table.projectId],
      foreignColumns: [environments.organizationId, environments.id, environments.projectId],
      name: "deployment_revisions_environment_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.releaseId, table.projectId],
      foreignColumns: [releases.organizationId, releases.id, releases.projectId],
      name: "deployment_revisions_release_fk",
    }).onDelete("restrict"),
  ],
);

export const userAssignments = platform.table(
  "user_assignments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    unique("user_assignments_environment_membership_uq").on(table.environmentId, table.membershipId),
    foreignKey({
      columns: [table.organizationId, table.membershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
      name: "user_assignments_membership_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.environmentId],
      foreignColumns: [environments.organizationId, environments.id],
      name: "user_assignments_environment_fk",
    }).onDelete("restrict"),
  ],
);

export const groupAssignments = platform.table(
  "group_assignments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    groupId: uuid("group_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    unique("group_assignments_environment_group_uq").on(table.environmentId, table.groupId),
    foreignKey({
      columns: [table.organizationId, table.groupId],
      foreignColumns: [organizationGroups.organizationId, organizationGroups.id],
      name: "group_assignments_group_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.environmentId],
      foreignColumns: [environments.organizationId, environments.id],
      name: "group_assignments_environment_fk",
    }).onDelete("restrict"),
  ],
);

export const devices = platform.table(
  "devices",
  {
    id: uuid("id").primaryKey(),
    ownerAccountId: uuid("owner_account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "restrict" }),
    clientInstanceId: uuid("client_instance_id").notNull().unique(),
    publicKeyJwk: jsonb("public_key_jwk").$type<Record<string, unknown>>().notNull(),
    displayName: text("display_name").notNull(),
    platform: text("platform").notNull(),
    appVersion: text("app_version").notNull(),
    status: text("status").default("active").notNull(),
    registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("devices_owner_account_idx").on(table.ownerAccountId)],
);

export const organizationDevices = platform.table(
  "organization_devices",
  {
    organizationId: uuid("organization_id").notNull(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id").notNull(),
    status: text("status").default("active").notNull(),
    registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.deviceId] }),
    foreignKey({
      columns: [table.organizationId, table.membershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
      name: "organization_devices_membership_fk",
    }).onDelete("restrict"),
  ],
);

export const installationObservations = platform.table(
  "installation_observations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    observedState: text("observed_state").notNull(),
    health: text("health").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown> | null>(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("installation_observations_device_environment_idx").on(
      table.organizationId,
      table.deviceId,
      table.environmentId,
      table.observedAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.deviceId],
      foreignColumns: [organizationDevices.organizationId, organizationDevices.deviceId],
      name: "installation_observations_device_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.environmentId],
      foreignColumns: [environments.organizationId, environments.id],
      name: "installation_observations_environment_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.releaseId],
      foreignColumns: [releases.organizationId, releases.id],
      name: "installation_observations_release_fk",
    }).onDelete("restrict"),
  ],
);

export const policies = platform.table(
  "policies",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").default("active").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("policies_org_key_uq").on(table.organizationId, table.key),
    unique("policies_org_id_uq").on(table.organizationId, table.id),
  ],
);

export const policyRevisions = platform.table(
  "policy_revisions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    policyId: uuid("policy_id").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull(),
    document: jsonb("document").$type<Record<string, unknown>>().notNull(),
    createdByMembershipId: uuid("created_by_membership_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("policy_revisions_policy_revision_uq").on(table.policyId, table.revision),
    unique("policy_revisions_org_id_uq").on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.policyId],
      foreignColumns: [policies.organizationId, policies.id],
      name: "policy_revisions_policy_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.createdByMembershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
      name: "policy_revisions_creator_fk",
    }).onDelete("restrict"),
  ],
);

export const policyProjectAssignments = platform.table(
  "policy_project_assignments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    policyRevisionId: uuid("policy_revision_id").notNull(),
    projectId: uuid("project_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    unique("policy_project_assignments_active_uq").on(table.policyRevisionId, table.projectId),
    foreignKey({
      columns: [table.organizationId, table.policyRevisionId],
      foreignColumns: [policyRevisions.organizationId, policyRevisions.id],
      name: "policy_project_assignments_revision_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
      name: "policy_project_assignments_project_fk",
    }).onDelete("restrict"),
  ],
);

export const policyGroupAssignments = platform.table(
  "policy_group_assignments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    policyRevisionId: uuid("policy_revision_id").notNull(),
    groupId: uuid("group_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    unique("policy_group_assignments_active_uq").on(table.policyRevisionId, table.groupId),
    foreignKey({
      columns: [table.organizationId, table.policyRevisionId],
      foreignColumns: [policyRevisions.organizationId, policyRevisions.id],
      name: "policy_group_assignments_revision_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.groupId],
      foreignColumns: [organizationGroups.organizationId, organizationGroups.id],
      name: "policy_group_assignments_group_fk",
    }).onDelete("restrict"),
  ],
);

export const policyMembershipAssignments = platform.table(
  "policy_membership_assignments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    policyRevisionId: uuid("policy_revision_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    unique("policy_membership_assignments_active_uq").on(
      table.policyRevisionId,
      table.membershipId,
    ),
    foreignKey({
      columns: [table.organizationId, table.policyRevisionId],
      foreignColumns: [policyRevisions.organizationId, policyRevisions.id],
      name: "policy_membership_assignments_revision_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.membershipId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.id],
      name: "policy_membership_assignments_membership_fk",
    }).onDelete("restrict"),
  ],
);

export const policyDeviceAssignments = platform.table(
  "policy_device_assignments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    policyRevisionId: uuid("policy_revision_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    unique("policy_device_assignments_active_uq").on(table.policyRevisionId, table.deviceId),
    foreignKey({
      columns: [table.organizationId, table.policyRevisionId],
      foreignColumns: [policyRevisions.organizationId, policyRevisions.id],
      name: "policy_device_assignments_revision_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.deviceId],
      foreignColumns: [organizationDevices.organizationId, organizationDevices.deviceId],
      name: "policy_device_assignments_device_fk",
    }).onDelete("restrict"),
  ],
);

export const credentialReferences = platform.table(
  "credential_references",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    providerKey: text("provider_key").notNull(),
    externalReference: text("external_reference").notNull(),
    status: text("status").default("active").notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("credential_references_org_external_uq").on(
      table.organizationId,
      table.providerKey,
      table.externalReference,
    ),
  ],
);
