import { randomUUID } from "node:crypto";

import { and, asc, eq, isNull } from "drizzle-orm";

import type { RadiusDatabase } from "./database.js";
import {
  mcpServerApprovalGrantRevocations,
  mcpServerApprovalGrants,
  mcpToolApprovalGrantRevocations,
  mcpToolApprovalGrants,
  capabilityContracts,
  capabilityOperations,
  toolBindings,
  toolProviders,
} from "./schema.js";
import { registerCapabilityContract } from "./connector-store.js";

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

export async function ensureBuiltinToolProvider(
  database: RadiusDatabase,
  input: {
    clientInstanceId: string;
    providerKey: string;
    label: string;
    connected: boolean;
    now?: number;
  },
): Promise<string> {
  const now = input.now ?? Date.now();
  return database.db.transaction(async (transaction) => {
    const existing = await transaction.query.toolProviders.findFirst({
      where: and(
        eq(toolProviders.clientInstanceId, input.clientInstanceId),
        eq(toolProviders.providerKey, input.providerKey),
      ),
    });
    if (existing) {
      await transaction
        .update(toolProviders)
        .set({
          label: input.label,
          connectionState: input.connected ? "connected" : "disconnected",
          connectedAtMs: input.connected ? now : existing.connectedAtMs,
          disconnectedAtMs: input.connected ? null : now,
          updatedAtMs: now,
        })
        .where(eq(toolProviders.id, existing.id));
      return existing.id;
    }
    const providerId = randomUUID();
    await transaction.insert(toolProviders).values({
      id: providerId,
      clientInstanceId: input.clientInstanceId,
      installationId: null,
      endpointId: null,
      profileConnectionId: null,
      appliedProfileRevision: null,
      providerKey: input.providerKey,
      label: input.label,
      credentialRef: null,
      connectionState: input.connected ? "connected" : "disconnected",
      connectedAtMs: input.connected ? now : null,
      disconnectedAtMs: input.connected ? null : now,
      updatedAtMs: now,
    });
    return providerId;
  });
}

export async function ensureBuiltinToolBinding(
  database: RadiusDatabase,
  input: {
    providerId: string;
    capabilityKey: string;
    contractVersion: number;
    displayName: string;
    description: string;
    operationName: string;
    nativeToolName: string;
    inputSchemaId: string;
    inputSchemaVersion: number;
    inputSchemaSha256: string;
    outputSchemaId: string;
    outputSchemaVersion: number;
    riskClass: "read" | "write" | "external_side_effect" | "privileged";
    now?: number;
  },
): Promise<string> {
  await registerCapabilityContract(database, {
    capabilityKey: input.capabilityKey,
    contractVersion: input.contractVersion,
    displayName: input.displayName,
    description: input.description,
    operations: [
      {
        operationName: input.operationName,
        inputSchemaId: input.inputSchemaId,
        inputSchemaVersion: input.inputSchemaVersion,
        outputSchemaId: input.outputSchemaId,
        outputSchemaVersion: input.outputSchemaVersion,
        riskClass: input.riskClass,
        approvalEligible: true,
      },
    ],
  });
  const now = input.now ?? Date.now();
  return database.db.transaction(async (transaction) => {
    const provider = await transaction.query.toolProviders.findFirst({
      where: eq(toolProviders.id, input.providerId),
    });
    if (!provider) throw new Error("MCP_PROVIDER_NOT_FOUND");
    const operation = await transaction
      .select({ id: capabilityOperations.id })
      .from(capabilityOperations)
      .innerJoin(
        capabilityContracts,
        eq(capabilityContracts.id, capabilityOperations.contractId),
      )
      .where(
        and(
          eq(capabilityContracts.capabilityKey, input.capabilityKey),
          eq(capabilityContracts.contractVersion, input.contractVersion),
          eq(capabilityOperations.operationName, input.operationName),
        ),
      )
      .get();
    if (!operation) throw new Error("MCP_CAPABILITY_OPERATION_NOT_FOUND");
    const existing = await transaction.query.toolBindings.findFirst({
      where: and(
        eq(toolBindings.providerId, input.providerId),
        eq(toolBindings.nativeToolName, input.nativeToolName),
        eq(toolBindings.inputSchemaSha256, input.inputSchemaSha256),
      ),
    });
    if (existing) {
      await transaction
        .update(toolBindings)
        .set({ enabled: true, disabledAtMs: null })
        .where(eq(toolBindings.id, existing.id));
      return existing.id;
    }
    const bindingId = randomUUID();
    await transaction.insert(toolBindings).values({
      id: bindingId,
      providerId: input.providerId,
      operationId: operation.id,
      nativeToolName: input.nativeToolName,
      inputSchemaSha256: input.inputSchemaSha256,
      outputSchemaSha256: null,
      enabled: true,
      discoveredAtMs: now,
      disabledAtMs: null,
    });
    return bindingId;
  });
}

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
