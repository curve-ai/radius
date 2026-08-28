import type {
  AgentToolInterface,
  CapabilityReference,
} from "@curve-ai/radius-connector-protocol";
import type {
  DiscoveredMcpTool,
  McpConnectorClient,
} from "@curve-ai/radius-mcp-connector";

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

export class ToolBroker {
  readonly #providers = new Map<string, ProviderRuntime>();

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
    if (binding.effect === "ask" && !input.approved) {
      throw new Error("TOOL_APPROVAL_REQUIRED");
    }
    return provider.client.callTool(binding.tool, input.arguments, {
      signal: input.signal,
      onProgress: input.onProgress,
    });
  }
}
