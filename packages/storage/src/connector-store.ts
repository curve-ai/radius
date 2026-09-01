import { randomUUID } from "node:crypto";

import {
  ConnectorCatalogEntrySchema,
  ConnectorManifestSchema,
} from "@curve-ai/radius-connector-protocol";
import { and, asc, eq, ne, sql } from "drizzle-orm";

import { canonicalJson, sha256Hex } from "./canonical-json.js";
import type { RadiusDatabase } from "./database.js";
import {
  capabilityContracts,
  capabilityOperations,
  connectorIdentities,
  connectorInstallations,
  connectorReleaseCapabilityMappings,
  connectorReleaseEndpoints,
  connectorReleases,
  profileConnectorConnections,
  profileConnectors,
  toolBindings,
  toolProviders,
} from "./schema.js";

type StorageTransaction = Parameters<
  Parameters<RadiusDatabase["db"]["transaction"]>[0]
>[0];

export interface ConnectorProviderSummary {
  id: string;
  label: string;
  providerKey: string;
  connectionState:
    "needs_authentication" | "connected" | "disconnected" | "error";
  profileConnectionId: string | null;
  toolCount: number;
}

export interface ConnectorSummary {
  id: string;
  connectorId: string;
  profileConnectorId: string | null;
  displayName: string;
  description: string;
  publisherKey: string;
  connectorKey: string;
  catalogSource: string | null;
  catalogExternalId: string | null;
  domain: string | null;
  logoUrl: string | null;
  version: string;
  lifecycleState: "staged" | "ready" | "disconnected" | "deleted" | "error";
  providers: ConnectorProviderSummary[];
}

export interface ConnectorEnabledToolSummary {
  name: string;
  providerId: string;
  providerLabel: string;
}

export interface ConnectorConnectionTarget {
  installationId: string;
  connectorId: string;
  connectorLabel: string;
  endpointId: string;
  endpointKey: string;
  endpointUrl: string;
  authentication: "none" | "oauth" | "bearer";
}

export interface DiscoveredConnectorToolInput {
  name: string;
  title: string | null;
  description: string | null;
  inputSchemaSha256: string;
  outputSchemaSha256: string | null;
}

export interface ReadyMcpToolBinding {
  bindingId: string;
  nativeToolName: string;
  inputSchemaSha256: string;
  outputSchemaSha256: string | null;
}

export interface ReadyMcpProvider {
  providerId: string;
  providerKey: string;
  label: string;
  endpointUrl: string;
  credentialRef: string | null;
  bindings: ReadyMcpToolBinding[];
}

export interface RegisterCapabilityContractInput {
  capabilityKey: string;
  contractVersion: number;
  displayName: string;
  description: string;
  operations: Array<{
    operationName: string;
    inputSchemaId: string;
    inputSchemaVersion: number;
    outputSchemaId: string;
    outputSchemaVersion: number;
    riskClass: "read" | "write" | "external_side_effect" | "privileged";
    approvalEligible: boolean;
  }>;
}

export interface InstallCustomConnectorInput {
  clientInstanceId: string;
  displayName: string;
  endpointUrl: string;
  now?: number;
}

function customConnectorEndpoint(value: string): URL {
  if (value.length > 2048) throw new Error("CONNECTOR_ENDPOINT_TOO_LONG");
  const url = new URL(value);
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("CONNECTOR_ENDPOINT_MUST_USE_HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("CONNECTOR_ENDPOINT_CREDENTIALS_NOT_ALLOWED");
  }
  return url;
}

export async function registerCapabilityContract(
  database: RadiusDatabase,
  input: RegisterCapabilityContractInput,
): Promise<string> {
  return database.db.transaction(async (transaction) => {
    const existing = await transaction.query.capabilityContracts.findFirst({
      where: and(
        eq(capabilityContracts.capabilityKey, input.capabilityKey),
        eq(capabilityContracts.contractVersion, input.contractVersion),
      ),
    });
    const contractId = existing?.id ?? randomUUID();
    if (!existing) {
      await transaction.insert(capabilityContracts).values({
        id: contractId,
        capabilityKey: input.capabilityKey,
        contractVersion: input.contractVersion,
        displayName: input.displayName,
        description: input.description,
      });
    }
    for (const operation of input.operations) {
      const existingOperation =
        await transaction.query.capabilityOperations.findFirst({
          where: and(
            eq(capabilityOperations.contractId, contractId),
            eq(capabilityOperations.operationName, operation.operationName),
          ),
        });
      if (existingOperation) continue;
      await transaction.insert(capabilityOperations).values({
        id: randomUUID(),
        contractId,
        ...operation,
      });
    }
    return contractId;
  });
}

async function resolveOperation(
  transaction: StorageTransaction,
  capability: {
    key: string;
    operation: string;
    contractVersion: number;
  },
): Promise<string> {
  const row = await transaction
    .select({ id: capabilityOperations.id })
    .from(capabilityOperations)
    .innerJoin(
      capabilityContracts,
      eq(capabilityContracts.id, capabilityOperations.contractId),
    )
    .where(
      and(
        eq(capabilityContracts.capabilityKey, capability.key),
        eq(capabilityContracts.contractVersion, capability.contractVersion),
        eq(capabilityOperations.operationName, capability.operation),
      ),
    )
    .get();
  if (!row) {
    throw new Error(
      `CAPABILITY_NOT_REGISTERED:${capability.key}.${capability.operation}@${capability.contractVersion}`,
    );
  }
  return row.id;
}

export async function installConnectorManifest(
  database: RadiusDatabase,
  input: {
    clientInstanceId: string;
    manifest: unknown;
    profileSubject?: string | null;
    now?: number;
  },
): Promise<ConnectorSummary> {
  const manifest = ConnectorManifestSchema.parse(input.manifest);
  const now = input.now ?? Date.now();
  const manifestSha256 = sha256Hex(canonicalJson(manifest));

  const installationId = await database.db.transaction(async (transaction) => {
    const existingIdentity =
      await transaction.query.connectorIdentities.findFirst({
        where: and(
          eq(connectorIdentities.publisherKey, manifest.publisherKey),
          eq(connectorIdentities.connectorKey, manifest.connectorKey),
        ),
      });
    const connectorId = existingIdentity?.id ?? randomUUID();
    if (!existingIdentity) {
      const domain = (() => {
        try {
          return new URL(manifest.endpoints[0]!.url).hostname
            .toLowerCase()
            .replace(/^www\./, "");
        } catch {
          return null;
        }
      })();
      await transaction.insert(connectorIdentities).values({
        id: connectorId,
        publisherKey: manifest.publisherKey,
        connectorKey: manifest.connectorKey,
        displayName: manifest.displayName,
        description: manifest.description,
        catalogSource: null,
        catalogExternalId: null,
        domain,
        logoUrl: null,
      });
    }

    const existingRelease = await transaction.query.connectorReleases.findFirst(
      {
        where: and(
          eq(connectorReleases.connectorId, connectorId),
          eq(connectorReleases.version, manifest.version),
        ),
      },
    );
    if (existingRelease && existingRelease.manifestSha256 !== manifestSha256) {
      throw new Error("CONNECTOR_RELEASE_IMMUTABILITY_CONFLICT");
    }
    const releaseId = existingRelease?.id ?? randomUUID();
    if (!existingRelease) {
      await transaction.insert(connectorReleases).values({
        id: releaseId,
        connectorId,
        version: manifest.version,
        manifestSha256,
        minimumHostVersion: manifest.minimumHostVersion,
        publishedAtMs: Date.parse(manifest.publishedAt),
        revokedAtMs: null,
        revocationReason: null,
      });
    }

    const endpointIds = new Map<string, string>();
    for (const endpoint of manifest.endpoints) {
      const existingEndpoint =
        await transaction.query.connectorReleaseEndpoints.findFirst({
          where: and(
            eq(connectorReleaseEndpoints.releaseId, releaseId),
            eq(connectorReleaseEndpoints.endpointKey, endpoint.key),
          ),
        });
      const endpointId = existingEndpoint?.id ?? randomUUID();
      endpointIds.set(endpoint.key, endpointId);
      if (!existingEndpoint) {
        await transaction.insert(connectorReleaseEndpoints).values({
          id: endpointId,
          releaseId,
          endpointKey: endpoint.key,
          transport: endpoint.transport,
          endpointUrl: endpoint.url,
          authentication: endpoint.authentication,
        });
      }
    }

    for (const mapping of manifest.capabilityMappings) {
      const endpointId = endpointIds.get(mapping.endpointKey);
      if (!endpointId) throw new Error("CONNECTOR_ENDPOINT_NOT_FOUND");
      const operationId = await resolveOperation(
        transaction,
        mapping.capability,
      );
      await transaction
        .insert(connectorReleaseCapabilityMappings)
        .values({
          releaseId,
          endpointId,
          operationId,
          nativeToolName: mapping.nativeToolName,
          inputSchemaSha256: mapping.inputSchemaSha256,
          outputSchemaSha256: mapping.outputSchemaSha256,
        })
        .onConflictDoNothing();
    }

    let profileConnectorId: string | null = null;
    if (input.profileSubject) {
      const existingProfile =
        await transaction.query.profileConnectors.findFirst({
          where: and(
            eq(profileConnectors.profileSubject, input.profileSubject),
            eq(profileConnectors.connectorId, connectorId),
          ),
        });
      profileConnectorId = existingProfile?.id ?? randomUUID();
      if (!existingProfile) {
        await transaction.insert(profileConnectors).values({
          id: profileConnectorId,
          profileSubject: input.profileSubject,
          connectorId,
          revision: 1,
          releaseSelectionMode: "exact",
          releaseSelectionValue: manifest.version,
          originClientInstanceId: input.clientInstanceId,
          createdAtMs: now,
          updatedAtMs: now,
          deletedAtMs: null,
        });
      }
    }

    const existingInstallation =
      await transaction.query.connectorInstallations.findFirst({
        where: and(
          eq(connectorInstallations.clientInstanceId, input.clientInstanceId),
          eq(connectorInstallations.connectorId, connectorId),
        ),
      });
    const nextInstallationId = existingInstallation?.id ?? randomUUID();
    if (existingInstallation) {
      await transaction
        .update(connectorInstallations)
        .set({
          selectedReleaseId: releaseId,
          profileConnectorId,
          appliedProfileRevision: profileConnectorId ? 1 : null,
          lifecycleState: "staged",
          updatedAtMs: now,
        })
        .where(eq(connectorInstallations.id, nextInstallationId));
    } else {
      await transaction.insert(connectorInstallations).values({
        id: nextInstallationId,
        clientInstanceId: input.clientInstanceId,
        connectorId,
        selectedReleaseId: releaseId,
        profileConnectorId,
        appliedProfileRevision: profileConnectorId ? 1 : null,
        lifecycleState: "staged",
        installedAtMs: now,
        updatedAtMs: now,
      });
    }
    return nextInstallationId;
  });

  const summary = (await listConnectors(database, input.clientInstanceId)).find(
    (item) => item.id === installationId,
  );
  if (!summary) throw new Error("CONNECTOR_INSTALLATION_NOT_FOUND");
  return summary;
}

export async function installCatalogConnector(
  database: RadiusDatabase,
  input: {
    clientInstanceId: string;
    catalogEntry: unknown;
    profileSubject?: string | null;
    now?: number;
  },
): Promise<ConnectorSummary> {
  const entry = ConnectorCatalogEntrySchema.parse(input.catalogEntry);
  const remoteUrl = entry.remoteUrl;
  if (entry.transport !== "streamable_http" || !remoteUrl) {
    throw new Error("CONNECTOR_CATALOG_ENTRY_NOT_REMOTE");
  }
  const now = input.now ?? Date.now();
  const installationId = await database.db.transaction(async (transaction) => {
    const existingIdentity =
      await transaction.query.connectorIdentities.findFirst({
        where: and(
          eq(connectorIdentities.catalogSource, entry.source),
          eq(connectorIdentities.catalogExternalId, entry.sourceServerName),
        ),
      });
    const connectorId = existingIdentity?.id ?? entry.id;
    if (existingIdentity) {
      await transaction
        .update(connectorIdentities)
        .set({
          displayName: entry.title,
          description: entry.description,
          domain: entry.domain,
          logoUrl: entry.logoUrl,
        })
        .where(eq(connectorIdentities.id, existingIdentity.id));
    } else {
      await transaction.insert(connectorIdentities).values({
        id: connectorId,
        publisherKey: "official-mcp-registry",
        connectorKey: entry.sourceServerName,
        displayName: entry.title,
        description: entry.description,
        catalogSource: entry.source,
        catalogExternalId: entry.sourceServerName,
        domain: entry.domain,
        logoUrl: entry.logoUrl,
      });
    }

    const manifestSha256 = sha256Hex(canonicalJson(entry));
    const existingRelease = await transaction.query.connectorReleases.findFirst(
      {
        where: and(
          eq(connectorReleases.connectorId, connectorId),
          eq(connectorReleases.version, entry.version),
        ),
      },
    );
    const releaseId = existingRelease?.id ?? randomUUID();
    if (!existingRelease) {
      await transaction.insert(connectorReleases).values({
        id: releaseId,
        connectorId,
        version: entry.version,
        manifestSha256,
        minimumHostVersion: "0.0.1",
        publishedAtMs: entry.publishedAt ? Date.parse(entry.publishedAt) : now,
        revokedAtMs: null,
        revocationReason: null,
      });
      await transaction.insert(connectorReleaseEndpoints).values({
        id: randomUUID(),
        releaseId,
        endpointKey: "default",
        transport: "streamable_http",
        endpointUrl: remoteUrl,
        authentication: "oauth",
      });
    }

    let profileConnectorId: string | null = null;
    if (input.profileSubject) {
      const existingProfile =
        await transaction.query.profileConnectors.findFirst({
          where: and(
            eq(profileConnectors.profileSubject, input.profileSubject),
            eq(profileConnectors.connectorId, connectorId),
          ),
        });
      profileConnectorId = existingProfile?.id ?? randomUUID();
      if (!existingProfile) {
        await transaction.insert(profileConnectors).values({
          id: profileConnectorId,
          profileSubject: input.profileSubject,
          connectorId,
          revision: 1,
          releaseSelectionMode: "exact",
          releaseSelectionValue: entry.version,
          originClientInstanceId: input.clientInstanceId,
          createdAtMs: now,
          updatedAtMs: now,
          deletedAtMs: null,
        });
      }
    }

    const existingInstallation =
      await transaction.query.connectorInstallations.findFirst({
        where: and(
          eq(connectorInstallations.clientInstanceId, input.clientInstanceId),
          eq(connectorInstallations.connectorId, connectorId),
        ),
      });
    const nextInstallationId = existingInstallation?.id ?? randomUUID();
    if (existingInstallation) {
      await transaction
        .update(connectorInstallations)
        .set({
          selectedReleaseId: releaseId,
          profileConnectorId,
          appliedProfileRevision: profileConnectorId ? 1 : null,
          lifecycleState: "staged",
          updatedAtMs: now,
        })
        .where(eq(connectorInstallations.id, nextInstallationId));
    } else {
      await transaction.insert(connectorInstallations).values({
        id: nextInstallationId,
        clientInstanceId: input.clientInstanceId,
        connectorId,
        selectedReleaseId: releaseId,
        profileConnectorId,
        appliedProfileRevision: profileConnectorId ? 1 : null,
        lifecycleState: "staged",
        installedAtMs: now,
        updatedAtMs: now,
      });
    }
    return nextInstallationId;
  });
  const summary = (await listConnectors(database, input.clientInstanceId)).find(
    (item) => item.id === installationId,
  );
  if (!summary) throw new Error("CONNECTOR_INSTALLATION_NOT_FOUND");
  return summary;
}

export async function installCustomConnector(
  database: RadiusDatabase,
  input: InstallCustomConnectorInput,
): Promise<ConnectorSummary> {
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 120) {
    throw new Error("CONNECTOR_NAME_INVALID");
  }
  const endpoint = customConnectorEndpoint(input.endpointUrl.trim());
  const now = input.now ?? Date.now();
  const connectorKey = sha256Hex(endpoint.href);
  const releaseVersion = `local-${connectorKey.slice(0, 12)}`;
  const manifestSha256 = sha256Hex(
    canonicalJson({ endpointUrl: endpoint.href }),
  );

  const installationId = await database.db.transaction(async (transaction) => {
    const existingIdentity =
      await transaction.query.connectorIdentities.findFirst({
        where: and(
          eq(connectorIdentities.publisherKey, "custom"),
          eq(connectorIdentities.connectorKey, connectorKey),
        ),
      });
    const connectorId = existingIdentity?.id ?? randomUUID();
    if (existingIdentity) {
      await transaction
        .update(connectorIdentities)
        .set({
          displayName,
          description: endpoint.href,
          domain: endpoint.hostname.toLowerCase().replace(/^www\./, ""),
        })
        .where(eq(connectorIdentities.id, connectorId));
    } else {
      await transaction.insert(connectorIdentities).values({
        id: connectorId,
        publisherKey: "custom",
        connectorKey,
        displayName,
        description: endpoint.href,
        catalogSource: null,
        catalogExternalId: null,
        domain: endpoint.hostname.toLowerCase().replace(/^www\./, ""),
        logoUrl: null,
      });
    }

    const existingRelease = await transaction.query.connectorReleases.findFirst(
      {
        where: and(
          eq(connectorReleases.connectorId, connectorId),
          eq(connectorReleases.version, releaseVersion),
        ),
      },
    );
    const releaseId = existingRelease?.id ?? randomUUID();
    if (!existingRelease) {
      await transaction.insert(connectorReleases).values({
        id: releaseId,
        connectorId,
        version: releaseVersion,
        manifestSha256,
        minimumHostVersion: "0.0.1",
        publishedAtMs: now,
        revokedAtMs: null,
        revocationReason: null,
      });
      await transaction.insert(connectorReleaseEndpoints).values({
        id: randomUUID(),
        releaseId,
        endpointKey: "default",
        transport: "streamable_http",
        endpointUrl: endpoint.href,
        authentication: "oauth",
      });
    }

    const existingInstallation =
      await transaction.query.connectorInstallations.findFirst({
        where: and(
          eq(connectorInstallations.clientInstanceId, input.clientInstanceId),
          eq(connectorInstallations.connectorId, connectorId),
        ),
      });
    const nextInstallationId = existingInstallation?.id ?? randomUUID();
    if (existingInstallation) {
      await transaction
        .update(connectorInstallations)
        .set({
          selectedReleaseId: releaseId,
          lifecycleState: "staged",
          updatedAtMs: now,
        })
        .where(eq(connectorInstallations.id, nextInstallationId));
    } else {
      await transaction.insert(connectorInstallations).values({
        id: nextInstallationId,
        clientInstanceId: input.clientInstanceId,
        connectorId,
        selectedReleaseId: releaseId,
        profileConnectorId: null,
        appliedProfileRevision: null,
        lifecycleState: "staged",
        installedAtMs: now,
        updatedAtMs: now,
      });
    }
    return nextInstallationId;
  });

  const summary = (await listConnectors(database, input.clientInstanceId)).find(
    (item) => item.id === installationId,
  );
  if (!summary) throw new Error("CONNECTOR_INSTALLATION_NOT_FOUND");
  return summary;
}

export async function configureConnectorProvider(
  database: RadiusDatabase,
  input: {
    clientInstanceId: string;
    installationId: string;
    endpointKey: string;
    label: string;
    credentialRef?: string | null;
    profileConnectionId?: string | null;
    now?: number;
  },
): Promise<string> {
  const now = input.now ?? Date.now();
  return database.db.transaction(async (transaction) => {
    const installation =
      await transaction.query.connectorInstallations.findFirst({
        where: and(
          eq(connectorInstallations.id, input.installationId),
          eq(connectorInstallations.clientInstanceId, input.clientInstanceId),
        ),
      });
    if (!installation) throw new Error("CONNECTOR_INSTALLATION_NOT_FOUND");
    const endpoint =
      await transaction.query.connectorReleaseEndpoints.findFirst({
        where: and(
          eq(
            connectorReleaseEndpoints.releaseId,
            installation.selectedReleaseId,
          ),
          eq(connectorReleaseEndpoints.endpointKey, input.endpointKey),
        ),
      });
    if (!endpoint) throw new Error("CONNECTOR_ENDPOINT_NOT_FOUND");
    const providerId = randomUUID();
    const connected =
      endpoint.authentication === "none" || Boolean(input.credentialRef);
    await transaction.insert(toolProviders).values({
      id: providerId,
      clientInstanceId: input.clientInstanceId,
      installationId: installation.id,
      endpointId: endpoint.id,
      profileConnectionId: input.profileConnectionId ?? null,
      appliedProfileRevision: input.profileConnectionId ? 1 : null,
      providerKey: `${installation.id}:${providerId}`,
      label: input.label.trim(),
      credentialRef: input.credentialRef ?? null,
      connectionState: connected ? "connected" : "needs_authentication",
      connectedAtMs: connected ? now : null,
      disconnectedAtMs: null,
      updatedAtMs: now,
    });
    await transaction
      .update(connectorInstallations)
      .set({
        lifecycleState: connected ? "ready" : "staged",
        updatedAtMs: now,
      })
      .where(eq(connectorInstallations.id, installation.id));
    return providerId;
  });
}

export async function getConnectorConnectionTarget(
  database: RadiusDatabase,
  clientInstanceId: string,
  installationId: string,
): Promise<ConnectorConnectionTarget> {
  const target = await database.db
    .select({
      installationId: connectorInstallations.id,
      connectorId: connectorIdentities.id,
      connectorLabel: connectorIdentities.displayName,
      endpointId: connectorReleaseEndpoints.id,
      endpointKey: connectorReleaseEndpoints.endpointKey,
      endpointUrl: connectorReleaseEndpoints.endpointUrl,
      authentication: connectorReleaseEndpoints.authentication,
    })
    .from(connectorInstallations)
    .innerJoin(
      connectorIdentities,
      eq(connectorIdentities.id, connectorInstallations.connectorId),
    )
    .innerJoin(
      connectorReleaseEndpoints,
      eq(
        connectorReleaseEndpoints.releaseId,
        connectorInstallations.selectedReleaseId,
      ),
    )
    .where(
      and(
        eq(connectorInstallations.id, installationId),
        eq(connectorInstallations.clientInstanceId, clientInstanceId),
        ne(connectorInstallations.lifecycleState, "deleted"),
      ),
    )
    .orderBy(asc(connectorReleaseEndpoints.endpointKey))
    .get();
  if (!target) throw new Error("CONNECTOR_INSTALLATION_NOT_FOUND");
  return target;
}

function discoveredOperationName(tool: DiscoveredConnectorToolInput): string {
  return `${tool.name}@${tool.inputSchemaSha256.slice(0, 16)}`;
}

export async function saveConnectorDiscovery(
  database: RadiusDatabase,
  input: {
    clientInstanceId: string;
    installationId: string;
    credentialRef: string | null;
    tools: DiscoveredConnectorToolInput[];
    now?: number;
  },
): Promise<string> {
  const target = await getConnectorConnectionTarget(
    database,
    input.clientInstanceId,
    input.installationId,
  );
  const capabilityKey = `mcp.connector.${target.connectorId}`;
  await registerCapabilityContract(database, {
    capabilityKey,
    contractVersion: 1,
    displayName: target.connectorLabel,
    description: `Tools discovered from ${target.connectorLabel}.`,
    operations: input.tools.map((tool) => ({
      operationName: discoveredOperationName(tool),
      inputSchemaId: `${capabilityKey}.${tool.name}.${tool.inputSchemaSha256}`,
      inputSchemaVersion: 1,
      outputSchemaId: `${capabilityKey}.${tool.name}.${tool.outputSchemaSha256 ?? "untyped"}`,
      outputSchemaVersion: 1,
      riskClass: "external_side_effect",
      approvalEligible: true,
    })),
  });

  const now = input.now ?? Date.now();
  return database.db.transaction(async (transaction) => {
    const existing = await transaction.query.toolProviders.findFirst({
      where: and(
        eq(toolProviders.installationId, target.installationId),
        eq(toolProviders.endpointId, target.endpointId),
      ),
    });
    const providerId = existing?.id ?? randomUUID();
    if (existing) {
      await transaction
        .update(toolProviders)
        .set({
          credentialRef: input.credentialRef,
          connectionState: "connected",
          connectedAtMs: now,
          disconnectedAtMs: null,
          updatedAtMs: now,
        })
        .where(eq(toolProviders.id, providerId));
    } else {
      await transaction.insert(toolProviders).values({
        id: providerId,
        clientInstanceId: input.clientInstanceId,
        installationId: target.installationId,
        endpointId: target.endpointId,
        profileConnectionId: null,
        appliedProfileRevision: null,
        providerKey: `${target.installationId}:${target.endpointKey}`,
        label: target.connectorLabel,
        credentialRef: input.credentialRef,
        connectionState: "connected",
        connectedAtMs: now,
        disconnectedAtMs: null,
        updatedAtMs: now,
      });
    }

    await transaction
      .update(toolBindings)
      .set({ enabled: false, disabledAtMs: now })
      .where(eq(toolBindings.providerId, providerId));

    for (const tool of input.tools) {
      const operationId = await resolveOperation(transaction, {
        key: capabilityKey,
        operation: discoveredOperationName(tool),
        contractVersion: 1,
      });
      await transaction
        .insert(toolBindings)
        .values({
          id: randomUUID(),
          providerId,
          operationId,
          nativeToolName: tool.name,
          inputSchemaSha256: tool.inputSchemaSha256,
          outputSchemaSha256: tool.outputSchemaSha256,
          enabled: true,
          discoveredAtMs: now,
          disabledAtMs: null,
        })
        .onConflictDoUpdate({
          target: [
            toolBindings.providerId,
            toolBindings.nativeToolName,
            toolBindings.inputSchemaSha256,
          ],
          set: {
            operationId,
            outputSchemaSha256: tool.outputSchemaSha256,
            enabled: true,
            discoveredAtMs: now,
            disabledAtMs: null,
          },
        });
    }
    await transaction
      .update(connectorInstallations)
      .set({ lifecycleState: "ready", updatedAtMs: now })
      .where(eq(connectorInstallations.id, target.installationId));
    return providerId;
  });
}

export async function listReadyMcpProviders(
  database: RadiusDatabase,
  clientInstanceId: string,
): Promise<ReadyMcpProvider[]> {
  const providers = await database.db
    .select({
      providerId: toolProviders.id,
      providerKey: toolProviders.providerKey,
      label: toolProviders.label,
      endpointUrl: connectorReleaseEndpoints.endpointUrl,
      credentialRef: toolProviders.credentialRef,
    })
    .from(toolProviders)
    .innerJoin(
      connectorReleaseEndpoints,
      eq(connectorReleaseEndpoints.id, toolProviders.endpointId),
    )
    .where(
      and(
        eq(toolProviders.clientInstanceId, clientInstanceId),
        eq(toolProviders.connectionState, "connected"),
      ),
    )
    .orderBy(asc(toolProviders.label));

  return Promise.all(
    providers.map(async (provider) => ({
      ...provider,
      bindings: await database.db
        .select({
          bindingId: toolBindings.id,
          nativeToolName: toolBindings.nativeToolName,
          inputSchemaSha256: toolBindings.inputSchemaSha256,
          outputSchemaSha256: toolBindings.outputSchemaSha256,
        })
        .from(toolBindings)
        .where(
          and(
            eq(toolBindings.providerId, provider.providerId),
            eq(toolBindings.enabled, true),
          ),
        )
        .orderBy(asc(toolBindings.nativeToolName)),
    })),
  );
}

export async function disconnectConnectorProvider(
  database: RadiusDatabase,
  providerId: string,
  now = Date.now(),
): Promise<string | null> {
  return database.db.transaction(async (transaction) => {
    const provider = await transaction.query.toolProviders.findFirst({
      where: eq(toolProviders.id, providerId),
    });
    if (!provider) throw new Error("CONNECTOR_PROVIDER_NOT_FOUND");
    await transaction
      .update(toolProviders)
      .set({
        credentialRef: null,
        connectionState: "disconnected",
        disconnectedAtMs: now,
        updatedAtMs: now,
      })
      .where(eq(toolProviders.id, providerId));
    await transaction
      .update(toolBindings)
      .set({ enabled: false, disabledAtMs: now })
      .where(eq(toolBindings.providerId, providerId));
    if (provider.installationId) {
      await transaction
        .update(connectorInstallations)
        .set({ lifecycleState: "disconnected", updatedAtMs: now })
        .where(eq(connectorInstallations.id, provider.installationId));
    }
    return provider.credentialRef;
  });
}

export async function deleteConnectorEverywhere(
  database: RadiusDatabase,
  installationId: string,
  now = Date.now(),
): Promise<void> {
  await database.db.transaction(async (transaction) => {
    const installation =
      await transaction.query.connectorInstallations.findFirst({
        where: eq(connectorInstallations.id, installationId),
      });
    if (!installation) throw new Error("CONNECTOR_INSTALLATION_NOT_FOUND");
    if (installation.profileConnectorId) {
      const profile = await transaction.query.profileConnectors.findFirst({
        where: eq(profileConnectors.id, installation.profileConnectorId),
      });
      if (profile) {
        await transaction
          .update(profileConnectorConnections)
          .set({
            revision: sql`${profileConnectorConnections.revision} + 1`,
            updatedAtMs: now,
            deletedAtMs: now,
          })
          .where(
            eq(profileConnectorConnections.profileConnectorId, profile.id),
          );
        await transaction
          .update(profileConnectors)
          .set({
            revision: profile.revision + 1,
            updatedAtMs: now,
            deletedAtMs: now,
          })
          .where(eq(profileConnectors.id, profile.id));
      }
    }
    const providers = await transaction
      .select({ id: toolProviders.id })
      .from(toolProviders)
      .where(eq(toolProviders.installationId, installation.id));
    for (const provider of providers) {
      await transaction
        .update(toolBindings)
        .set({ enabled: false, disabledAtMs: now })
        .where(eq(toolBindings.providerId, provider.id));
      await transaction
        .update(toolProviders)
        .set({
          credentialRef: null,
          connectionState: "disconnected",
          disconnectedAtMs: now,
          updatedAtMs: now,
        })
        .where(eq(toolProviders.id, provider.id));
    }
    await transaction
      .update(connectorInstallations)
      .set({ lifecycleState: "deleted", updatedAtMs: now })
      .where(eq(connectorInstallations.id, installation.id));
  });
}

export async function listConnectors(
  database: RadiusDatabase,
  clientInstanceId: string,
): Promise<ConnectorSummary[]> {
  const installations = await database.db
    .select({
      id: connectorInstallations.id,
      connectorId: connectorIdentities.id,
      profileConnectorId: connectorInstallations.profileConnectorId,
      displayName: connectorIdentities.displayName,
      description: connectorIdentities.description,
      publisherKey: connectorIdentities.publisherKey,
      connectorKey: connectorIdentities.connectorKey,
      catalogSource: connectorIdentities.catalogSource,
      catalogExternalId: connectorIdentities.catalogExternalId,
      domain: connectorIdentities.domain,
      logoUrl: connectorIdentities.logoUrl,
      version: connectorReleases.version,
      lifecycleState: connectorInstallations.lifecycleState,
    })
    .from(connectorInstallations)
    .innerJoin(
      connectorIdentities,
      eq(connectorIdentities.id, connectorInstallations.connectorId),
    )
    .innerJoin(
      connectorReleases,
      eq(connectorReleases.id, connectorInstallations.selectedReleaseId),
    )
    .where(
      and(
        eq(connectorInstallations.clientInstanceId, clientInstanceId),
        ne(connectorInstallations.lifecycleState, "deleted"),
      ),
    )
    .orderBy(asc(connectorIdentities.displayName));

  const result: ConnectorSummary[] = [];
  for (const installation of installations) {
    const providers = await database.db
      .select({
        id: toolProviders.id,
        label: toolProviders.label,
        providerKey: toolProviders.providerKey,
        connectionState: toolProviders.connectionState,
        profileConnectionId: toolProviders.profileConnectionId,
      })
      .from(toolProviders)
      .where(eq(toolProviders.installationId, installation.id))
      .orderBy(asc(toolProviders.label));
    const providerSummaries: ConnectorProviderSummary[] = [];
    for (const provider of providers) {
      const bindings = await database.db
        .select({ id: toolBindings.id })
        .from(toolBindings)
        .where(
          and(
            eq(toolBindings.providerId, provider.id),
            eq(toolBindings.enabled, true),
          ),
        );
      providerSummaries.push({ ...provider, toolCount: bindings.length });
    }
    result.push({ ...installation, providers: providerSummaries });
  }
  return result;
}

export async function listConnectorEnabledTools(
  database: RadiusDatabase,
  clientInstanceId: string,
  installationId: string,
): Promise<ConnectorEnabledToolSummary[]> {
  return database.db
    .select({
      name: toolBindings.nativeToolName,
      providerId: toolProviders.id,
      providerLabel: toolProviders.label,
    })
    .from(toolBindings)
    .innerJoin(toolProviders, eq(toolProviders.id, toolBindings.providerId))
    .where(
      and(
        eq(toolProviders.clientInstanceId, clientInstanceId),
        eq(toolProviders.installationId, installationId),
        eq(toolBindings.enabled, true),
      ),
    )
    .orderBy(asc(toolBindings.nativeToolName), asc(toolProviders.label));
}
