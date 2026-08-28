import {
  deleteConnectorEverywhere,
  disconnectConnectorProvider,
  installCustomConnector,
  listConnectorEnabledTools,
  listConnectors,
  type ConnectorEnabledToolSummary,
  registerCapabilityContract,
  type ConnectorSummary,
} from "@curve-ai/radius-storage";
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

export async function disconnectConnectorForRenderer(
  providerId: unknown,
): Promise<void> {
  if (typeof providerId !== "string" || !providerId) {
    throw new Error("A connector provider identifier is required");
  }
  const context = await initializeStorage();
  await disconnectConnectorProvider(context.database, providerId);
}

export async function deleteConnectorForRenderer(
  installationId: unknown,
): Promise<void> {
  if (typeof installationId !== "string" || !installationId) {
    throw new Error("A connector installation identifier is required");
  }
  const context = await initializeStorage();
  await deleteConnectorEverywhere(context.database, installationId);
}
