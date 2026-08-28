import {
  AgentConfigSchema,
  AgentManifestSchema,
  RADIUS_AGENT_MANIFEST_VERSION,
  type AgentConfig,
  type AgentConfigInput,
  type AgentManifest,
} from "@curve-ai/agent-contracts";

export function defineConfig(config: AgentConfigInput): AgentConfig {
  return AgentConfigSchema.parse(config);
}

export function createAgentManifest(
  configInput: AgentConfigInput,
): AgentManifest {
  const config = AgentConfigSchema.parse(configInput);
  return AgentManifestSchema.parse({
    schemaVersion: RADIUS_AGENT_MANIFEST_VERSION,
    agent: config.agent,
    name: config.name,
    protocol: { kind: "acp-stdio", version: 1 },
    runtime: config.runtime,
    capabilities: config.capabilities,
    networkAllowlist: config.networkAllowlist,
    resources: config.resources,
    minimumDesktopVersion: config.minimumDesktopVersion,
  });
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}
