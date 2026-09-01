import assert from "node:assert/strict";
import test from "node:test";

import { McpConnectorClient } from "@curve-ai/radius-mcp-connector";

import {
  resolveAgentConnectorAvailability,
  startBrokeredMcpServer,
  ToolBroker,
} from "./index.js";

const interfaceRequired = {
  kind: "radius.mcp" as const,
  requirement: "required" as const,
  declaration: "manifest" as const,
  protocolVersions: ["2026-07-28"],
};

const request = {
  key: "presentations",
  operation: "create",
  contractVersion: 1,
  requirement: "required" as const,
};

test("hides an agent whose required connector is unavailable", () => {
  assert.deepEqual(
    resolveAgentConnectorAvailability({
      interfaces: [interfaceRequired],
      capabilityRequests: [request],
      bindings: [],
    }),
    {
      selectable: false,
      exposeMcpBridge: false,
      availableCapabilities: [],
      missingRequiredCapabilities: [request],
    },
  );
});

test("omits optional MCP without hiding the agent", () => {
  const result = resolveAgentConnectorAvailability({
    interfaces: [{ ...interfaceRequired, requirement: "optional" }],
    capabilityRequests: [{ ...request, requirement: "optional" }],
    bindings: [],
  });
  assert.equal(result.selectable, true);
  assert.equal(result.exposeMcpBridge, false);
});

test("exposes MCP only for a connected healthy exact binding", () => {
  const result = resolveAgentConnectorAvailability({
    interfaces: [interfaceRequired],
    capabilityRequests: [request],
    bindings: [
      {
        providerId: "provider-1",
        capabilityKey: "presentations",
        operation: "create",
        contractVersion: 1,
        connected: true,
        healthy: true,
      },
    ],
  });
  assert.equal(result.selectable, true);
  assert.equal(result.exposeMcpBridge, true);
});

test("a remembered provider or tool grant bypasses invocation approval", async () => {
  let calls = 0;
  const client = {
    callTool: async () => {
      calls += 1;
      return { content: [] };
    },
  } as unknown as McpConnectorClient;
  const broker = new ToolBroker({
    isApproved: ({ providerId, bindingId }) =>
      providerId === "provider-1" && bindingId === "binding-1",
  });
  broker.registerProvider("provider-1", client, [
    {
      bindingId: "binding-1",
      providerId: "provider-1",
      capabilityKey: "presentations",
      operation: "create",
      contractVersion: 1,
      effect: "ask",
      tool: {
        name: "create_presentation",
        title: "Create presentation",
        description: null,
        inputSchemaSha256: "a".repeat(64),
        outputSchemaSha256: null,
        definition: {
          name: "create_presentation",
          inputSchema: { type: "object" },
        },
      },
    },
  ]);

  await broker.call({
    providerId: "provider-1",
    bindingId: "binding-1",
    arguments: {},
    approved: false,
  });
  assert.equal(calls, 1);
});

test("serves discovered remote tools through a guest-safe MCP endpoint", async () => {
  const upstream = {
    callTool: async () => ({
      content: [{ type: "text" as const, text: "brokered result" }],
    }),
  } as unknown as McpConnectorClient;
  const tool = {
    bindingId: "binding-1",
    providerId: "provider-1",
    capabilityKey: "mcp.connector.test",
    operation: "search",
    contractVersion: 1,
    effect: "ask" as const,
    tool: {
      name: "search",
      title: "Search",
      description: "Search connected data.",
      inputSchemaSha256: "a".repeat(64),
      outputSchemaSha256: null,
      definition: {
        name: "search",
        inputSchema: {
          type: "object" as const,
          properties: { query: { type: "string" as const } },
          required: ["query"],
        },
      },
    },
  };
  const server = await startBrokeredMcpServer({
    name: "radius-test",
    providerId: "provider-1",
    client: upstream,
    tools: [tool],
    authorize: () => true,
  });
  const token = server.headers.find(
    (header) => header.name === "Authorization",
  )?.value;
  assert.ok(token?.startsWith("Bearer "));
  const client = new McpConnectorClient({
    endpoint: server.localUrl,
    token: async () => token!.slice("Bearer ".length),
  });
  try {
    await client.connect();
    const [discovered] = await client.listTools();
    assert.equal(discovered?.name, "search");
    const result = await client.callTool(discovered!, { query: "radius" });
    assert.deepEqual(result.content, [
      { type: "text", text: "brokered result" },
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});
