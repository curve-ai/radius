import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentToolInterfaceSchema,
  ConnectorCatalogListResponseSchema,
  ConnectorManifestSchema,
  ConnectorProfileChangeSchema,
} from "./index.js";

const id = "11111111-1111-4111-8111-111111111111";
const hash = "a".repeat(64);

test("accepts manifest and runtime-discovered MCP support", () => {
  assert.equal(
    AgentToolInterfaceSchema.parse({
      kind: "radius.mcp",
      requirement: "required",
      declaration: "runtime_discovery",
      protocolVersions: ["2026-07-28"],
    }).declaration,
    "runtime_discovery",
  );
});

test("rejects capability mappings for an unknown endpoint", () => {
  const result = ConnectorManifestSchema.safeParse({
    schemaVersion: 1,
    publisherKey: "curve-ai",
    connectorKey: "slides",
    displayName: "Slides",
    description: "Create presentations.",
    version: "1.0.0",
    minimumHostVersion: "1.0.0",
    publishedAt: "2026-08-24T12:00:00.000Z",
    endpoints: [
      {
        key: "default",
        transport: "streamable_http",
        url: "https://example.com/mcp",
        authentication: "oauth",
      },
    ],
    capabilityMappings: [
      {
        endpointKey: "missing",
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
  });
  assert.equal(result.success, false);
});

test("requires tombstones for profile deletes", () => {
  const result = ConnectorProfileChangeSchema.safeParse({
    protocolVersion: 1,
    changeId: id,
    originClientInstanceId: id,
    payloadSchemaVersion: 1,
    payloadSha256: hash,
    createdAt: "2026-08-24T12:00:00.000Z",
    kind: "profile_connector.delete",
    profileConnectorId: id,
    revision: 1,
    payload: {
      id,
      connectorId: id,
      revision: 1,
      releaseSelectionMode: "channel",
      releaseSelectionValue: "stable",
      originClientInstanceId: id,
      createdAt: "2026-08-24T12:00:00.000Z",
      updatedAt: "2026-08-24T12:00:00.000Z",
      deletedAt: null,
    },
  });
  assert.equal(result.success, false);
});

test("accepts catalog taxonomy facets and connector memberships", () => {
  const response = ConnectorCatalogListResponseSchema.parse({
    protocolVersion: 3,
    connectors: [
      {
        id,
        source: "official_mcp_registry",
        sourceServerName: "io.github.example/server",
        title: "Example",
        description: "Example connector",
        category: "developer_tools",
        categoryIds: ["developer_tools", "data_databases"],
        version: "1.0.0",
        transport: "streamable_http",
        remoteUrl: "https://example.com/mcp",
        repositoryUrl: null,
        websiteUrl: "https://example.com",
        domain: "example.com",
        logoUrl: null,
        publishedAt: null,
        updatedAt: "2026-08-29T12:00:00.000Z",
      },
    ],
    categories: [
      {
        id: "developer_tools",
        label: "Developer Tools",
        description: "Code and developer workflows.",
        count: 1,
      },
    ],
    categoryPreviews: [
      {
        categoryId: "developer_tools",
        connectors: [],
      },
    ],
    nextCursor: null,
  });

  assert.deepEqual(response.connectors[0]?.categoryIds, [
    "developer_tools",
    "data_databases",
  ]);
});
