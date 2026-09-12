import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConnectorCatalogListResponse } from "@curve-ai/radius-connector-protocol";

import { resolveConnectorCatalogResponseLogos } from "./connector-catalog-logos";

const entry = {
  id: "44ee4947-8e05-57da-9ae3-45b9e378572a",
  source: "official_mcp_registry" as const,
  sourceServerName: "com.example/mcp",
  title: "Example",
  description: "Example connector",
  category: "other" as const,
  categoryIds: ["developer_tools"],
  version: "1.0.0",
  transport: "streamable_http" as const,
  remoteUrl: "https://mcp.example.com/mcp",
  repositoryUrl: null,
  websiteUrl: "https://example.com/",
  domain: "example.com",
  logoUrl: "https://cdn.example.com/logo.png",
  publishedAt: null,
  updatedAt: "2026-09-12T00:00:00.000Z",
};

test("resolves logos for flat results and nested category previews", async () => {
  const response: ConnectorCatalogListResponse = {
    protocolVersion: 3,
    connectors: [entry],
    categories: [
      {
        id: "developer_tools",
        label: "Developer Tools",
        description: "Developer tooling",
        count: 1,
      },
    ],
    categoryPreviews: [{ categoryId: "developer_tools", connectors: [entry] }],
    nextCursor: null,
  };
  const resolved = await resolveConnectorCatalogResponseLogos(
    response,
    async (entries) =>
      entries.map((value) => ({
        ...value,
        logoUrl: "data:image/png;base64,AA==",
      })),
  );
  assert.equal(resolved.connectors[0]?.logoUrl, "data:image/png;base64,AA==");
  assert.equal(
    resolved.categoryPreviews[0]?.connectors[0]?.logoUrl,
    "data:image/png;base64,AA==",
  );
});
