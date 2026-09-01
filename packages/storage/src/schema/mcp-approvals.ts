import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { id } from "./common.js";
import { toolBindings, toolProviders } from "./connectors.js";

export const mcpToolApprovalGrants = sqliteTable(
  "mcp_tool_approval_grants",
  {
    id: text("id").primaryKey(),
    toolBindingId: id("tool_binding_id").references(() => toolBindings.id, {
      onDelete: "restrict",
    }),
    grantedAtMs: integer("granted_at_ms").notNull(),
    actorType: text("actor_type", { enum: ["local_user"] }).notNull(),
  },
  (table) => [
    index("mcp_tool_approval_grants_binding_idx").on(table.toolBindingId),
    check(
      "mcp_tool_approval_grants_actor_valid",
      sql`${table.actorType} = 'local_user'`,
    ),
  ],
);

export const mcpToolApprovalGrantRevocations = sqliteTable(
  "mcp_tool_approval_grant_revocations",
  {
    grantId: id("grant_id")
      .primaryKey()
      .references(() => mcpToolApprovalGrants.id, { onDelete: "restrict" }),
    revokedAtMs: integer("revoked_at_ms").notNull(),
    actorType: text("actor_type", { enum: ["local_user"] }).notNull(),
  },
  (table) => [
    check(
      "mcp_tool_approval_grant_revocations_actor_valid",
      sql`${table.actorType} = 'local_user'`,
    ),
  ],
);

export const mcpServerApprovalGrants = sqliteTable(
  "mcp_server_approval_grants",
  {
    id: text("id").primaryKey(),
    providerId: id("provider_id").references(() => toolProviders.id, {
      onDelete: "restrict",
    }),
    grantedAtMs: integer("granted_at_ms").notNull(),
    actorType: text("actor_type", { enum: ["local_user"] }).notNull(),
  },
  (table) => [
    index("mcp_server_approval_grants_provider_idx").on(table.providerId),
    check(
      "mcp_server_approval_grants_actor_valid",
      sql`${table.actorType} = 'local_user'`,
    ),
  ],
);

export const mcpServerApprovalGrantRevocations = sqliteTable(
  "mcp_server_approval_grant_revocations",
  {
    grantId: id("grant_id")
      .primaryKey()
      .references(() => mcpServerApprovalGrants.id, { onDelete: "restrict" }),
    revokedAtMs: integer("revoked_at_ms").notNull(),
    actorType: text("actor_type", { enum: ["local_user"] }).notNull(),
  },
  (table) => [
    check(
      "mcp_server_approval_grant_revocations_actor_valid",
      sql`${table.actorType} = 'local_user'`,
    ),
  ],
);
