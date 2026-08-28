import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ConnectorManifest } from "@curve-ai/radius-connector-protocol";

import {
  configureConnectorProvider,
  deleteConnectorEverywhere,
  disconnectConnectorProvider,
  installCatalogConnector,
  installConnectorManifest,
  installCustomConnector,
  listConnectorEnabledTools,
  listConnectors,
  registerCapabilityContract,
} from "./connector-store.js";
import { migrateRadiusDatabase, openRadiusDatabase } from "./database.js";
import {
  capabilityOperations,
  clientInstances,
  toolBindings,
} from "./schema.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const clientId = "19353755-3c5e-4529-b58d-c74dacf7b68d";
const hash = "a".repeat(64);

const manifest: ConnectorManifest = {
  schemaVersion: 1,
  publisherKey: "curve-ai",
  connectorKey: "slides",
  displayName: "Slides",
  description: "Create presentations from structured briefs.",
  version: "1.0.0",
  minimumHostVersion: "0.0.1",
  publishedAt: "2026-08-24T12:00:00.000Z",
  endpoints: [
    {
      key: "default",
      transport: "streamable_http",
      url: "https://slides.example.com/mcp",
      authentication: "oauth",
    },
  ],
  capabilityMappings: [
    {
      endpointKey: "default",
      capability: {
        key: "presentations",
        operation: "create",
        contractVersion: 1,
      },
      nativeToolName: "create_presentation",
      inputSchemaSha256: hash,
      outputSchemaSha256: null,
    },
  ],
};

async function withDatabase(
  callback: (
    database: Awaited<ReturnType<typeof openRadiusDatabase>>,
  ) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "radius-connectors-"));
  const database = await openRadiusDatabase({
    path: path.join(directory, "radius.db"),
  });
  try {
    await migrateRadiusDatabase(database, migrationsFolder);
    const now = Date.parse("2026-08-24T12:00:00.000Z");
    await database.db.insert(clientInstances).values({
      id: clientId,
      displayName: "Test Mac",
      platform: "darwin",
      publicKeyJwk: JSON.stringify({ kty: "OKP", crv: "Ed25519", x: "test" }),
      isLocal: true,
      createdAtMs: now,
      updatedAtMs: now,
    });
    await callback(database);
  } finally {
    database.close();
    await rm(directory, { force: true, recursive: true });
  }
}

test("installs, disconnects locally, and deletes a profile connector", async () => {
  await withDatabase(async (database) => {
    await registerCapabilityContract(database, {
      capabilityKey: "presentations",
      contractVersion: 1,
      displayName: "Presentations",
      description: "Create and update presentations.",
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
    const installed = await installConnectorManifest(database, {
      clientInstanceId: clientId,
      profileSubject: "profile-1",
      manifest,
    });
    assert.equal(installed.lifecycleState, "staged");

    const providerId = await configureConnectorProvider(database, {
      clientInstanceId: clientId,
      installationId: installed.id,
      endpointKey: "default",
      label: "Work account",
      credentialRef: "connector-secret:one",
    });
    const operation = await database.db.query.capabilityOperations.findFirst();
    assert.ok(operation);
    await database.db.insert(toolBindings).values({
      id: "binding-1",
      providerId,
      operationId: operation.id,
      nativeToolName: "create_presentation",
      inputSchemaSha256: hash,
      outputSchemaSha256: null,
      enabled: true,
      discoveredAtMs: Date.parse("2026-08-24T12:00:00.000Z"),
      disabledAtMs: null,
    });
    assert.deepEqual(
      await listConnectorEnabledTools(database, clientId, installed.id),
      [
        {
          name: "create_presentation",
          providerId,
          providerLabel: "Work account",
        },
      ],
    );
    assert.equal(
      (await listConnectors(database, clientId))[0]?.providers[0]
        ?.connectionState,
      "connected",
    );

    await disconnectConnectorProvider(database, providerId);
    assert.equal(
      (await listConnectors(database, clientId))[0]?.providers[0]
        ?.connectionState,
      "disconnected",
    );

    await deleteConnectorEverywhere(database, installed.id);
    assert.deepEqual(await listConnectors(database, clientId), []);
  });
});

test("installs a public remote catalog entry as staged setup", async () => {
  await withDatabase(async (database) => {
    const installed = await installCatalogConnector(database, {
      clientInstanceId: clientId,
      catalogEntry: {
        id: "22222222-2222-4222-8222-222222222222",
        source: "official_mcp_registry",
        sourceServerName: "com.example/slides",
        title: "Example Slides",
        description: "Create and update presentations.",
        category: "productivity",
        featured: false,
        version: "1.0.0",
        transport: "streamable_http",
        remoteUrl: "https://slides.example.com/mcp",
        repositoryUrl: "https://github.com/example/slides-mcp",
        websiteUrl: "https://slides.example.com",
        domain: "slides.example.com",
        logoUrl: "https://assets.example.com/logo.png",
        publishedAt: "2026-08-24T12:00:00.000Z",
        updatedAt: "2026-08-24T12:00:00.000Z",
      },
    });
    assert.equal(installed.lifecycleState, "staged");
    assert.equal(installed.catalogExternalId, "com.example/slides");
    assert.equal(installed.domain, "slides.example.com");
    assert.equal(installed.providers.length, 0);
  });
});

test("installs a custom HTTPS connector without a manifest file", async () => {
  await withDatabase(async (database) => {
    const installed = await installCustomConnector(database, {
      clientInstanceId: clientId,
      displayName: "OpenBudget",
      endpointUrl: "https://api.openbudget.sh/mcp",
      now: Date.parse("2026-08-24T12:00:00.000Z"),
    });

    assert.equal(installed.displayName, "OpenBudget");
    assert.equal(installed.description, "https://api.openbudget.sh/mcp");
    assert.equal(installed.catalogSource, null);
    assert.equal(installed.domain, "api.openbudget.sh");
    assert.equal(installed.lifecycleState, "staged");
    assert.equal(installed.providers.length, 0);
  });
});

test("rejects insecure non-loopback custom connector endpoints", async () => {
  await withDatabase(async (database) => {
    await assert.rejects(
      installCustomConnector(database, {
        clientInstanceId: clientId,
        displayName: "Unsafe connector",
        endpointUrl: "http://example.com/mcp",
      }),
      /CONNECTOR_ENDPOINT_MUST_USE_HTTPS/,
    );
  });
});
