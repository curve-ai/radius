import { createHash } from "node:crypto";

import {
  Client,
  StreamableHTTPClientTransport,
  type AuthProvider,
  type CallToolResult,
  type OAuthClientProvider,
  type Tool,
  UnauthorizedError,
} from "@modelcontextprotocol/client";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_DISCOVERED_TOOLS = 256;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

export function schemaSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function validateConnectorEndpoint(value: string): URL {
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

export interface DiscoveredMcpTool {
  name: string;
  title: string | null;
  description: string | null;
  inputSchemaSha256: string;
  outputSchemaSha256: string | null;
  definition: Tool;
}

export interface McpConnectorClientOptions {
  endpoint: string;
  token?: () => Promise<string | undefined>;
  authProvider?: AuthProvider | OAuthClientProvider;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class McpConnectorClient {
  readonly #client: Client;
  readonly #transport: StreamableHTTPClientTransport;
  readonly #timeoutMs: number;
  #connected = false;

  constructor(options: McpConnectorClientOptions) {
    const endpoint = validateConnectorEndpoint(options.endpoint);
    if (options.token && options.authProvider) {
      throw new Error("CONNECTOR_AUTH_PROVIDER_CONFLICT");
    }
    const authProvider =
      options.authProvider ??
      (options.token ? { token: options.token } : undefined);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#client = new Client(
      { name: "radius", version: "0.0.1" },
      {
        enforceStrictCapabilities: true,
        versionNegotiation: {
          mode: "auto",
          probe: { timeoutMs: this.#timeoutMs, maxRetries: 0 },
        },
      },
    );
    this.#transport = new StreamableHTTPClientTransport(endpoint, {
      ...(authProvider ? { authProvider } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      onInsufficientScope: "throw",
      maxStepUpRetries: 0,
    });
  }

  async connect(signal?: AbortSignal): Promise<void> {
    if (this.#connected) return;
    await this.#client.connect(this.#transport, {
      signal,
      timeout: this.#timeoutMs,
    });
    this.#connected = true;
  }

  async listTools(signal?: AbortSignal): Promise<DiscoveredMcpTool[]> {
    if (!this.#connected) throw new Error("CONNECTOR_NOT_CONNECTED");
    const result = await this.#client.listTools(undefined, {
      signal,
      timeout: this.#timeoutMs,
      cacheMode: "refresh",
    });
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_RESULT_BYTES) {
      throw new Error("CONNECTOR_TOOL_LIST_TOO_LARGE");
    }
    if (result.tools.length > MAX_DISCOVERED_TOOLS) {
      throw new Error("CONNECTOR_TOOL_LIST_TOO_LARGE");
    }
    return result.tools.map((tool) => ({
      name: boundedToolName(tool.name),
      title: boundedOptionalText(tool.title, 200),
      description: boundedOptionalText(tool.description, 10_000),
      inputSchemaSha256: schemaSha256(tool.inputSchema),
      outputSchemaSha256:
        tool.outputSchema === undefined
          ? null
          : schemaSha256(tool.outputSchema),
      definition: tool,
    }));
  }

  async finishAuth(callbackParams: URLSearchParams): Promise<void> {
    await this.#transport.finishAuth(callbackParams);
  }

  async callTool(
    tool: DiscoveredMcpTool,
    input: Record<string, unknown>,
    options?: {
      signal?: AbortSignal;
      onProgress?: (progress: unknown) => void;
    },
  ): Promise<CallToolResult> {
    if (!this.#connected) throw new Error("CONNECTOR_NOT_CONNECTED");
    const result = await this.#client.callTool(
      { name: tool.name, arguments: input },
      {
        signal: options?.signal,
        timeout: this.#timeoutMs,
        toolDefinition: tool.definition,
        ...(options?.onProgress
          ? { onprogress: (progress) => options.onProgress?.(progress) }
          : {}),
      },
    );
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_RESULT_BYTES) {
      throw new Error("CONNECTOR_RESULT_TOO_LARGE");
    }
    return result;
  }

  async close(): Promise<void> {
    this.#connected = false;
    await this.#client.close();
  }
}

function boundedToolName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized !== value || normalized.length > 256) {
    throw new Error("CONNECTOR_TOOL_NAME_INVALID");
  }
  return normalized;
}

function boundedOptionalText(
  value: string | undefined,
  maxLength: number,
): string | null {
  if (value === undefined) return null;
  return value.slice(0, maxLength);
}

export function isMcpUnauthorizedError(error: unknown): boolean {
  return UnauthorizedError.isInstance(error);
}

export type {
  AuthProvider,
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
