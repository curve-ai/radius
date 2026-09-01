import {
  deleteConnectorEverywhere,
  disconnectConnectorProvider,
  getConnectorConnectionTarget,
  installCustomConnector,
  listMcpApprovalGrants,
  listConnectorEnabledTools,
  listConnectors,
  type ConnectorEnabledToolSummary,
  type McpApprovalGrantSummary,
  registerCapabilityContract,
  revokeMcpApproval,
  saveConnectorDiscovery,
  type ConnectorSummary,
} from "@curve-ai/radius-storage";
import {
  connectInteractiveMcpClient,
  mcpCredentialReference,
} from "./mcp-connector-auth";
import { localDeviceIdentity } from "./device-identity";
import { initializeStorage } from "./storage";
import {
  getConnectorLogoForDomain,
  requestConnectorLogoResolution,
} from "./connector-catalog";

export async function initializeConnectorRegistry(): Promise<void> {
  const context = await initializeStorage();
  await registerCapabilityContract(context.database, {
    capabilityKey: "presentations",
    contractVersion: 1,
    displayName: "Presentations",
    description: "Create presentations from structured content.",
    operations: [
      {
        operationName: "create",
        inputSchemaId: "radius.presentations.create",
        inputSchemaVersion: 1,
        outputSchemaId: "radius.presentations.created",
        outputSchemaVersion: 1,
        riskClass: "external_side_effect",
        approvalEligible: true,
      },
    ],
  });
}

export async function listConnectorsForRenderer(): Promise<ConnectorSummary[]> {
  const context = await initializeStorage();
  const connectors = await listConnectors(
    context.database,
    localDeviceIdentity(context.vault).clientInstanceId,
  );
  return Promise.all(
    connectors.map(async (connector) => {
      if (connector.logoUrl || !connector.domain) return connector;
      try {
        return {
          ...connector,
          logoUrl: await getConnectorLogoForDomain(connector.domain),
        };
      } catch {
        return connector;
      }
    }),
  );
}

export async function listConnectorToolsForRenderer(
  installationId: unknown,
): Promise<ConnectorEnabledToolSummary[]> {
  if (typeof installationId !== "string" || !installationId) {
    throw new Error("A connector installation identifier is required");
  }
  const context = await initializeStorage();
  return listConnectorEnabledTools(
    context.database,
    localDeviceIdentity(context.vault).clientInstanceId,
    installationId,
  );
}

export async function installConnectorForRenderer(
  input: unknown,
): Promise<ConnectorSummary> {
  if (typeof input !== "object" || input === null) {
    throw new Error("Connector details are required");
  }
  const { name, url } = input as { name?: unknown; url?: unknown };
  if (typeof name !== "string" || typeof url !== "string") {
    throw new Error("Connector name and URL are required");
  }
  const context = await initializeStorage();
  const installed = await installCustomConnector(context.database, {
    clientInstanceId: localDeviceIdentity(context.vault).clientInstanceId,
    displayName: name,
    endpointUrl: url,
  });
  if (installed.domain) {
    void requestConnectorLogoResolution(installed.domain, url).catch(
      () => undefined,
    );
  }
  return installed;
}

export async function connectConnectorForRenderer(
  installationId: unknown,
): Promise<ConnectorSummary> {
  if (typeof installationId !== "string" || !installationId) {
    throw new Error("A connector installation identifier is required");
  }
  const context = await initializeStorage();
  const clientInstanceId = localDeviceIdentity(context.vault).clientInstanceId;
  const target = await getConnectorConnectionTarget(
    context.database,
    clientInstanceId,
    installationId,
  );
  const credentialRef = mcpCredentialReference(installationId);
  const connection = await connectInteractiveMcpClient({
    endpoint: target.endpointUrl,
    vault: context.vault,
    credentialRef,
  });
  try {
    const tools = await connection.client.listTools();
    await saveConnectorDiscovery(context.database, {
      clientInstanceId,
      installationId,
      credentialRef: connection.credentialRef,
      tools,
    });
  } finally {
    await connection.client.close().catch(() => undefined);
  }
  const connected = (
    await listConnectors(context.database, clientInstanceId)
  ).find((connector) => connector.id === installationId);
  if (!connected) throw new Error("CONNECTOR_INSTALLATION_NOT_FOUND");
  return connected;
}

export async function disconnectConnectorForRenderer(
  providerId: unknown,
): Promise<void> {
  if (typeof providerId !== "string" || !providerId) {
    throw new Error("A connector provider identifier is required");
  }
  const context = await initializeStorage();
  const credentialRef = await disconnectConnectorProvider(
    context.database,
    providerId,
  );
  if (credentialRef) await context.vault.deleteSecret(credentialRef);
}

export async function deleteConnectorForRenderer(
  installationId: unknown,
): Promise<void> {
  if (typeof installationId !== "string" || !installationId) {
    throw new Error("A connector installation identifier is required");
  }
  const context = await initializeStorage();
  const connectors = await listConnectors(
    context.database,
    localDeviceIdentity(context.vault).clientInstanceId,
  );
  const target = connectors.find(
    (connector) => connector.id === installationId,
  );
  const providerIds = new Set(
    (target?.providers ?? []).map((provider) => provider.id),
  );
  const grants = await listMcpApprovalGrants(
    context.database,
    localDeviceIdentity(context.vault).clientInstanceId,
  );
  for (const grant of grants) {
    if (!providerIds.has(grant.providerId)) continue;
    await revokeMcpApproval(context.database, {
      grantId: grant.grantId,
      scope: grant.scope,
    });
  }
  for (const provider of target?.providers ?? []) {
    const credentialRef = await disconnectConnectorProvider(
      context.database,
      provider.id,
    );
    if (credentialRef) await context.vault.deleteSecret(credentialRef);
  }
  await deleteConnectorEverywhere(context.database, installationId);
}

export async function listMcpApprovalsForRenderer(): Promise<
  McpApprovalGrantSummary[]
> {
  const context = await initializeStorage();
  return listMcpApprovalGrants(
    context.database,
    localDeviceIdentity(context.vault).clientInstanceId,
  );
}

export async function revokeMcpApprovalForRenderer(
  input: unknown,
): Promise<void> {
  if (!input || typeof input !== "object") {
    throw new Error("An MCP approval grant is required");
  }
  const value = input as Record<string, unknown>;
  if (
    typeof value.grantId !== "string" ||
    !value.grantId ||
    (value.scope !== "server" && value.scope !== "tool")
  ) {
    throw new Error("The MCP approval grant is invalid");
  }
  const context = await initializeStorage();
  await revokeMcpApproval(context.database, {
    grantId: value.grantId,
    scope: value.scope,
  });
}
