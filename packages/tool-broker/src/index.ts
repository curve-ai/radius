import type {
  AgentToolInterface,
  CapabilityReference,
} from "@curve-ai/radius-connector-protocol";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type {
  DiscoveredMcpTool,
  McpConnectorClient,
} from "@curve-ai/radius-mcp-connector";
import {
  fromJsonSchema,
  type CallToolResult,
  type JsonSchemaType,
} from "@modelcontextprotocol/client";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

const GUEST_HOST = "192.168.64.1";
const GUEST_ADDRESS = "192.168.64.2";

export type AuthorizationEffect = "allow" | "ask" | "deny" | "unavailable";

export interface ReadyToolBinding {
  providerId: string;
  capabilityKey: string;
  operation: string;
  contractVersion: number;
  connected: boolean;
  healthy: boolean;
}

export interface AgentConnectorAvailability {
  selectable: boolean;
  exposeMcpBridge: boolean;
  availableCapabilities: CapabilityReference[];
  missingRequiredCapabilities: CapabilityReference[];
}

function bindingMatches(
  request: CapabilityReference,
  binding: ReadyToolBinding,
): boolean {
  return (
    binding.connected &&
    binding.healthy &&
    binding.capabilityKey === request.key &&
    binding.operation === request.operation &&
    binding.contractVersion === request.contractVersion
  );
}

export function resolveAgentConnectorAvailability(input: {
  interfaces: AgentToolInterface[];
  capabilityRequests: CapabilityReference[];
  bindings: ReadyToolBinding[];
}): AgentConnectorAvailability {
  const mcpInterface = input.interfaces.find(
    (item) => item.kind === "radius.mcp",
  );
  if (!mcpInterface) {
    return {
      selectable: true,
      exposeMcpBridge: false,
      availableCapabilities: [],
      missingRequiredCapabilities: [],
    };
  }

  const availableCapabilities: CapabilityReference[] = [];
  const missingRequiredCapabilities: CapabilityReference[] = [];
  for (const request of input.capabilityRequests) {
    const available = input.bindings.some((binding) =>
      bindingMatches(request, binding),
    );
    if (available) availableCapabilities.push(request);
    else if (request.requirement === "required") {
      missingRequiredCapabilities.push(request);
    }
  }

  const interfaceMissing =
    mcpInterface.requirement === "required" &&
    availableCapabilities.length === 0;
  return {
    selectable: !interfaceMissing && missingRequiredCapabilities.length === 0,
    exposeMcpBridge: availableCapabilities.length > 0,
    availableCapabilities,
    missingRequiredCapabilities,
  };
}

export interface BrokeredTool {
  bindingId: string;
  providerId: string;
  capabilityKey: string;
  operation: string;
  contractVersion: number;
  effect: Exclude<AuthorizationEffect, "deny" | "unavailable">;
  tool: DiscoveredMcpTool;
}

interface ProviderRuntime {
  client: McpConnectorClient;
  tools: Map<string, BrokeredTool>;
}

export interface ToolApprovalResolver {
  isApproved(input: {
    providerId: string;
    bindingId: string;
  }): boolean | Promise<boolean>;
}

export class ToolBroker {
  readonly #providers = new Map<string, ProviderRuntime>();

  constructor(private readonly approvalResolver?: ToolApprovalResolver) {}

  registerProvider(
    providerId: string,
    client: McpConnectorClient,
    tools: BrokeredTool[],
  ): void {
    if (this.#providers.has(providerId)) {
      throw new Error("TOOL_PROVIDER_ALREADY_REGISTERED");
    }
    this.#providers.set(providerId, {
      client,
      tools: new Map(tools.map((tool) => [tool.bindingId, tool])),
    });
  }

  unregisterProvider(providerId: string): void {
    this.#providers.delete(providerId);
  }

  async call(input: {
    providerId: string;
    bindingId: string;
    arguments: Record<string, unknown>;
    approved: boolean;
    signal?: AbortSignal;
    onProgress?: (progress: unknown) => void;
  }): Promise<unknown> {
    const provider = this.#providers.get(input.providerId);
    if (!provider) throw new Error("TOOL_PROVIDER_UNAVAILABLE");
    const binding = provider.tools.get(input.bindingId);
    if (!binding) throw new Error("TOOL_BINDING_UNAVAILABLE");
    const rememberedApproval =
      binding.effect === "ask" && !input.approved && this.approvalResolver
        ? await this.approvalResolver.isApproved({
            providerId: input.providerId,
            bindingId: input.bindingId,
          })
        : false;
    if (binding.effect === "ask" && !input.approved && !rememberedApproval) {
      throw new Error("TOOL_APPROVAL_REQUIRED");
    }
    return provider.client.callTool(binding.tool, input.arguments, {
      signal: input.signal,
      onProgress: input.onProgress,
    });
  }
}

export interface BrokeredMcpServer {
  name: string;
  url: string;
  localUrl: string;
  headers: Array<{ name: string; value: string }>;
  close(): Promise<void>;
}

export async function startBrokeredMcpServer(input: {
  name: string;
  providerId: string;
  client: McpConnectorClient;
  tools: BrokeredTool[];
  approvalResolver?: ToolApprovalResolver;
  authorize(binding: BrokeredTool): boolean | Promise<boolean>;
}): Promise<BrokeredMcpServer> {
  const broker = new ToolBroker(input.approvalResolver);
  broker.registerProvider(input.providerId, input.client, input.tools);
  const token = randomBytes(32).toString("base64url");
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: input.name, version: "0.0.1" });
    for (const binding of input.tools) {
      server.registerTool(
        binding.tool.name,
        {
          ...(binding.tool.title ? { title: binding.tool.title } : {}),
          ...(binding.tool.description
            ? { description: binding.tool.description }
            : {}),
          inputSchema: fromJsonSchema(
            binding.tool.definition.inputSchema as JsonSchemaType,
          ),
          ...(binding.tool.definition.outputSchema
            ? {
                outputSchema: fromJsonSchema(
                  binding.tool.definition.outputSchema as JsonSchemaType,
                ),
              }
            : {}),
        },
        async (argumentsValue) =>
          (await broker.call({
            providerId: input.providerId,
            bindingId: binding.bindingId,
            arguments: argumentsValue as Record<string, unknown>,
            approved: await input.authorize(binding),
          })) as CallToolResult,
      );
    }
    return server;
  });
  const nodeHandler = toNodeHandler(handler);
  let server: Server;
  server = createServer((request, response) => {
    const remoteAddress = normalizeAddress(request.socket.remoteAddress);
    if (remoteAddress !== GUEST_ADDRESS && remoteAddress !== "127.0.0.1") {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (
      request.headers.origin ||
      request.headers.authorization !== `Bearer ${token}`
    ) {
      response
        .writeHead(401, { "www-authenticate": "Bearer" })
        .end("Unauthorized");
      return;
    }
    if (!request.url?.startsWith("/mcp")) {
      response.writeHead(404).end("Not found");
      return;
    }
    void nodeHandler(request, response);
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 64;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    await handler.close();
    throw new Error("BROKERED_MCP_SERVER_ADDRESS_UNAVAILABLE");
  }
  return {
    name: input.name,
    url: `http://${GUEST_HOST}:${address.port}/mcp`,
    localUrl: `http://127.0.0.1:${address.port}/mcp`,
    headers: [{ name: "Authorization", value: `Bearer ${token}` }],
    async close() {
      await handler.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function normalizeAddress(value: string | undefined): string {
  if (!value) return "";
  if (value.startsWith("::ffff:")) return value.slice("::ffff:".length);
  return value;
}
