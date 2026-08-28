import { sql } from "drizzle-orm";
import {
  check,
  index,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { bytea, radiusPlatform } from "./common.js";

export const accounts = radiusPlatform.table(
  "accounts",
  {
    id: uuid("account_id").primaryKey(),
    displayName: text("display_name"),
    lifecycleState: text("lifecycle_state").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    check(
      "accounts_display_name_check",
      sql`${table.displayName} IS NULL OR char_length(btrim(${table.displayName})) BETWEEN 1 AND 120`,
    ),
    check(
      "accounts_lifecycle_state_check",
      sql`${table.lifecycleState} IN ('active', 'disabled')`,
    ),
    check(
      "accounts_timestamps_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const accountIdentities = radiusPlatform.table(
  "account_identities",
  {
    id: uuid("account_identity_id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    issuer: text("issuer").notNull(),
    providerSubject: text("provider_subject").notNull(),
    emailNormalized: text("email_normalized"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    lastAuthenticatedAt: timestamp("last_authenticated_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    index("account_identities_account_idx").on(table.accountId),
    uniqueIndex("account_identities_issuer_subject_key").on(
      table.issuer,
      table.providerSubject,
    ),
    check(
      "account_identities_issuer_check",
      sql`char_length(btrim(${table.issuer})) BETWEEN 1 AND 512`,
    ),
    check(
      "account_identities_subject_check",
      sql`char_length(${table.providerSubject}) BETWEEN 1 AND 512`,
    ),
    check(
      "account_identities_email_check",
      sql`${table.emailNormalized} IS NULL OR (char_length(${table.emailNormalized}) BETWEEN 3 AND 320 AND ${table.emailNormalized} = lower(${table.emailNormalized}))`,
    ),
    check(
      "account_identities_auth_time_check",
      sql`${table.lastAuthenticatedAt} IS NULL OR ${table.lastAuthenticatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const platformSessions = radiusPlatform.table(
  "platform_sessions",
  {
    id: uuid("session_id").primaryKey(),
    accountIdentityId: uuid("account_identity_id")
      .notNull()
      .references(() => accountIdentities.id, { onDelete: "restrict" }),
    tokenHash: bytea("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("platform_sessions_identity_idx").on(table.accountIdentityId),
    index("platform_sessions_active_expiry_idx")
      .on(table.expiresAt)
      .where(sql`${table.revokedAt} IS NULL`),
    uniqueIndex("platform_sessions_token_hash_key").on(table.tokenHash),
    check(
      "platform_sessions_token_hash_check",
      sql`octet_length(${table.tokenHash}) = 32`,
    ),
    check(
      "platform_sessions_prefix_check",
      sql`char_length(${table.tokenPrefix}) BETWEEN 4 AND 32`,
    ),
    check(
      "platform_sessions_expiry_check",
      sql`${table.expiresAt} > ${table.issuedAt}`,
    ),
    check(
      "platform_sessions_last_used_check",
      sql`${table.lastUsedAt} IS NULL OR ${table.lastUsedAt} >= ${table.issuedAt}`,
    ),
    check(
      "platform_sessions_revoked_check",
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.issuedAt}`,
    ),
  ],
);
