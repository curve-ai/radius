import { randomUUID } from "node:crypto";

import { and, asc, eq, isNull } from "drizzle-orm";

import type { RadiusDatabase } from "./database.js";
import {
  mcpServerApprovalGrantRevocations,
  mcpServerApprovalGrants,
  mcpToolApprovalGrantRevocations,
  mcpToolApprovalGrants,
  toolBindings,
  toolProviders,
} from "./schema.js";

export type McpApprovalGrantSummary =
  | {
      grantId: string;
      scope: "server";
      providerId: string;
      providerLabel: string;
      toolName: null;
      grantedAt: string;
    }
  | {
      grantId: string;
      scope: "tool";
      providerId: string;
      providerLabel: string;
      toolName: string;
      grantedAt: string;
    };

export async function hasMcpServerApproval(
  database: RadiusDatabase,
  providerId: string,
): Promise<boolean> {
  const active = await database.db
    .select({ grantId: mcpServerApprovalGrants.id })
    .from(mcpServerApprovalGrants)
    .leftJoin(
      mcpServerApprovalGrantRevocations,
      eq(mcpServerApprovalGrantRevocations.grantId, mcpServerApprovalGrants.id),
    )
    .where(
      and(
        eq(mcpServerApprovalGrants.providerId, providerId),
        isNull(mcpServerApprovalGrantRevocations.grantId),
      ),
    )
    .limit(1);
  return active.length > 0;
}

export async function grantMcpServerApproval(
  database: RadiusDatabase,
  providerId: string,
  now = Date.now(),
): Promise<string> {
  return database.db.transaction(async (transaction) => {
    const provider = await transaction.query.toolProviders.findFirst({
      where: eq(toolProviders.id, providerId),
    });
    if (!provider) throw new Error("MCP_PROVIDER_NOT_FOUND");
    const active = await transaction
      .select({ grantId: mcpServerApprovalGrants.id })
      .from(mcpServerApprovalGrants)
      .leftJoin(
        mcpServerApprovalGrantRevocations,
        eq(
          mcpServerApprovalGrantRevocations.grantId,
          mcpServerApprovalGrants.id,
        ),
      )
      .where(
        and(
          eq(mcpServerApprovalGrants.providerId, providerId),
          isNull(mcpServerApprovalGrantRevocations.grantId),
        ),
      )
      .limit(1);
    if (active[0]) return active[0].grantId;
    const grantId = randomUUID();
    await transaction.insert(mcpServerApprovalGrants).values({
      id: grantId,
      providerId,
      grantedAtMs: now,
      actorType: "local_user",
    });
    return grantId;
  });
}

export async function grantMcpToolApproval(
  database: RadiusDatabase,
  bindingId: string,
  now = Date.now(),
): Promise<string> {
  return database.db.transaction(async (transaction) => {
    const binding = await transaction.query.toolBindings.findFirst({
      where: eq(toolBindings.id, bindingId),
    });
    if (!binding) throw new Error("MCP_TOOL_BINDING_NOT_FOUND");
    const active = await transaction
      .select({ grantId: mcpToolApprovalGrants.id })
      .from(mcpToolApprovalGrants)
      .leftJoin(
        mcpToolApprovalGrantRevocations,
        eq(mcpToolApprovalGrantRevocations.grantId, mcpToolApprovalGrants.id),
      )
      .where(
        and(
          eq(mcpToolApprovalGrants.toolBindingId, bindingId),
          isNull(mcpToolApprovalGrantRevocations.grantId),
        ),
      )
      .limit(1);
    if (active[0]) return active[0].grantId;
    const grantId = randomUUID();
    await transaction.insert(mcpToolApprovalGrants).values({
      id: grantId,
      toolBindingId: bindingId,
      grantedAtMs: now,
      actorType: "local_user",
    });
    return grantId;
  });
}

export async function hasMcpToolApproval(
  database: RadiusDatabase,
  bindingId: string,
): Promise<boolean> {
  const active = await database.db
    .select({ grantId: mcpToolApprovalGrants.id })
    .from(mcpToolApprovalGrants)
    .leftJoin(
      mcpToolApprovalGrantRevocations,
      eq(mcpToolApprovalGrantRevocations.grantId, mcpToolApprovalGrants.id),
    )
    .where(
      and(
        eq(mcpToolApprovalGrants.toolBindingId, bindingId),
        isNull(mcpToolApprovalGrantRevocations.grantId),
      ),
    )
    .limit(1);
  return active.length > 0;
}

export async function hasMcpApproval(
  database: RadiusDatabase,
  input: { providerId: string; bindingId: string },
): Promise<boolean> {
  const binding = await database.db.query.toolBindings.findFirst({
    where: and(
      eq(toolBindings.id, input.bindingId),
      eq(toolBindings.providerId, input.providerId),
    ),
  });
  if (!binding) return false;
  return (
    (await hasMcpServerApproval(database, input.providerId)) ||
    (await hasMcpToolApproval(database, input.bindingId))
  );
}

export async function revokeMcpApproval(
  database: RadiusDatabase,
  input: { grantId: string; scope: "server" | "tool"; now?: number },
): Promise<void> {
  const now = input.now ?? Date.now();
  await database.db.transaction(async (transaction) => {
    if (input.scope === "server") {
      const grant = await transaction.query.mcpServerApprovalGrants.findFirst({
        where: eq(mcpServerApprovalGrants.id, input.grantId),
      });
      if (!grant) throw new Error("MCP_APPROVAL_GRANT_NOT_FOUND");
      await transaction
        .insert(mcpServerApprovalGrantRevocations)
        .values({
          grantId: input.grantId,
          revokedAtMs: now,
          actorType: "local_user",
        })
        .onConflictDoNothing();
      return;
    }
    const grant = await transaction.query.mcpToolApprovalGrants.findFirst({
      where: eq(mcpToolApprovalGrants.id, input.grantId),
    });
    if (!grant) throw new Error("MCP_APPROVAL_GRANT_NOT_FOUND");
    await transaction
      .insert(mcpToolApprovalGrantRevocations)
      .values({
        grantId: input.grantId,
        revokedAtMs: now,
        actorType: "local_user",
      })
      .onConflictDoNothing();
  });
}

export async function listMcpApprovalGrants(
  database: RadiusDatabase,
  clientInstanceId: string,
): Promise<McpApprovalGrantSummary[]> {
  const servers = await database.db
    .select({
      grantId: mcpServerApprovalGrants.id,
      providerId: toolProviders.id,
      providerLabel: toolProviders.label,
      grantedAtMs: mcpServerApprovalGrants.grantedAtMs,
    })
    .from(mcpServerApprovalGrants)
    .innerJoin(
      toolProviders,
      eq(toolProviders.id, mcpServerApprovalGrants.providerId),
    )
    .leftJoin(
      mcpServerApprovalGrantRevocations,
      eq(mcpServerApprovalGrantRevocations.grantId, mcpServerApprovalGrants.id),
    )
    .where(
      and(
        eq(toolProviders.clientInstanceId, clientInstanceId),
        isNull(mcpServerApprovalGrantRevocations.grantId),
      ),
    )
    .orderBy(asc(toolProviders.label));
  const tools = await database.db
    .select({
      grantId: mcpToolApprovalGrants.id,
      providerId: toolProviders.id,
      providerLabel: toolProviders.label,
      toolName: toolBindings.nativeToolName,
      grantedAtMs: mcpToolApprovalGrants.grantedAtMs,
    })
    .from(mcpToolApprovalGrants)
    .innerJoin(
      toolBindings,
      eq(toolBindings.id, mcpToolApprovalGrants.toolBindingId),
    )
    .innerJoin(toolProviders, eq(toolProviders.id, toolBindings.providerId))
    .leftJoin(
      mcpToolApprovalGrantRevocations,
      eq(mcpToolApprovalGrantRevocations.grantId, mcpToolApprovalGrants.id),
    )
    .where(
      and(
        eq(toolProviders.clientInstanceId, clientInstanceId),
        isNull(mcpToolApprovalGrantRevocations.grantId),
      ),
    )
    .orderBy(asc(toolProviders.label), asc(toolBindings.nativeToolName));
  return [
    ...servers.map((grant): McpApprovalGrantSummary => ({
      grantId: grant.grantId,
      scope: "server",
      providerId: grant.providerId,
      providerLabel: grant.providerLabel,
      toolName: null,
      grantedAt: new Date(grant.grantedAtMs).toISOString(),
    })),
    ...tools.map((grant): McpApprovalGrantSummary => ({
      grantId: grant.grantId,
      scope: "tool",
      providerId: grant.providerId,
      providerLabel: grant.providerLabel,
      toolName: grant.toolName,
      grantedAt: new Date(grant.grantedAtMs).toISOString(),
    })),
  ];
}
