import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { accounts } from "./identity.js";
import { bytea, radiusPlatform } from "./common.js";

export const organizations = radiusPlatform.table(
  "organizations",
  {
    id: uuid("organization_id").primaryKey(),
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
    uniqueIndex("organizations_slug_key").on(table.slug),
    check(
      "organizations_slug_check",
      sql`${table.slug} ~ '^[a-z][a-z0-9-]{0,62}$'`,
    ),
    check(
      "organizations_display_name_check",
      sql`char_length(btrim(${table.displayName})) BETWEEN 1 AND 120`,
    ),
    check(
      "organizations_lifecycle_state_check",
      sql`${table.lifecycleState} IN ('active', 'suspended', 'archived')`,
    ),
    check(
      "organizations_timestamps_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const organizationMemberships = radiusPlatform.table(
  "organization_memberships",
  {
    id: uuid("membership_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    roleCode: text("role_code").notNull(),
    lifecycleState: text("lifecycle_state").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    index("organization_memberships_account_idx").on(table.accountId),
    index("organization_memberships_organization_state_idx").on(
      table.organizationId,
      table.lifecycleState,
    ),
    uniqueIndex("organization_memberships_account_key").on(
      table.organizationId,
      table.accountId,
    ),
    unique("organization_memberships_identity_key").on(
      table.id,
      table.organizationId,
    ),
    check(
      "organization_memberships_role_check",
      sql`${table.roleCode} IN ('owner', 'admin', 'developer', 'viewer')`,
    ),
    check(
      "organization_memberships_lifecycle_state_check",
      sql`${table.lifecycleState} IN ('active', 'suspended', 'removed')`,
    ),
    check(
      "organization_memberships_timestamps_check",
      sql`${table.updatedAt} >= ${table.joinedAt}`,
    ),
  ],
);

export const developerTokens = radiusPlatform.table(
  "developer_tokens",
  {
    id: uuid("developer_token_id").primaryKey(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => organizationMemberships.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    tokenHash: bytea("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("developer_tokens_membership_idx").on(table.membershipId),
    uniqueIndex("developer_tokens_hash_key").on(table.tokenHash),
    check(
      "developer_tokens_label_check",
      sql`char_length(btrim(${table.label})) BETWEEN 1 AND 120`,
    ),
    check(
      "developer_tokens_hash_check",
      sql`octet_length(${table.tokenHash}) = 32`,
    ),
    check(
      "developer_tokens_prefix_check",
      sql`char_length(${table.tokenPrefix}) BETWEEN 4 AND 32`,
    ),
    check(
      "developer_tokens_expiry_check",
      sql`${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "developer_tokens_last_used_check",
      sql`${table.lastUsedAt} IS NULL OR ${table.lastUsedAt} >= ${table.createdAt}`,
    ),
    check(
      "developer_tokens_revoked_check",
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const developerTokenScopes = radiusPlatform.table(
  "developer_token_scopes",
  {
    developerTokenId: uuid("developer_token_id")
      .notNull()
      .references(() => developerTokens.id, { onDelete: "cascade" }),
    scopeCode: text("scope_code").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.developerTokenId, table.scopeCode] }),
    check(
      "developer_token_scopes_code_check",
      sql`${table.scopeCode} ~ '^[a-z][a-z0-9_.:-]{1,127}$'`,
    ),
  ],
);
