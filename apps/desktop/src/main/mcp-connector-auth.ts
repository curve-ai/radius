import {
  McpConnectorClient,
  isMcpUnauthorizedError,
  type OAuthClientInformationContext,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@curve-ai/radius-mcp-connector";
import { shell } from "electron";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

import type { CredentialVault } from "./credential-vault";

const OAUTH_TIMEOUT_MS = 10 * 60_000;
const CALLBACK_PATH = "/oauth/callback";

interface StoredMcpOAuthBundle {
  version: 1;
  clients: Record<string, StoredOAuthClientInformation>;
  clientRedirects: Record<string, string>;
  tokens: Record<string, StoredOAuthTokens>;
  lastIssuer: string | null;
  codeVerifier: string | null;
  discoveryState: OAuthDiscoveryState | null;
}

function emptyBundle(): StoredMcpOAuthBundle {
  return {
    version: 1,
    clients: {},
    clientRedirects: {},
    tokens: {},
    lastIssuer: null,
    codeVerifier: null,
    discoveryState: null,
  };
}

function parseBundle(value: string | null): StoredMcpOAuthBundle {
  if (!value) return emptyBundle();
  const parsed = JSON.parse(value) as Partial<StoredMcpOAuthBundle>;
  if (
    parsed.version !== 1 ||
    !parsed.clients ||
    typeof parsed.clients !== "object" ||
    Array.isArray(parsed.clients) ||
    (parsed.clientRedirects !== undefined &&
      (typeof parsed.clientRedirects !== "object" ||
        parsed.clientRedirects === null ||
        Array.isArray(parsed.clientRedirects))) ||
    !parsed.tokens ||
    typeof parsed.tokens !== "object" ||
    Array.isArray(parsed.tokens) ||
    (parsed.lastIssuer !== null && typeof parsed.lastIssuer !== "string") ||
    (parsed.codeVerifier !== null && typeof parsed.codeVerifier !== "string") ||
    (parsed.discoveryState !== null &&
      typeof parsed.discoveryState !== "object")
  ) {
    throw new Error("MCP_OAUTH_CREDENTIAL_INVALID");
  }
  return {
    ...(parsed as StoredMcpOAuthBundle),
    clientRedirects: parsed.clientRedirects ?? {},
  };
}

export function mcpCredentialReference(installationId: string): string {
  return `connector:mcp:${installationId}`;
}

class OAuthCallbackListener {
  readonly redirectUrl: URL;
  readonly #server: Server;
  readonly #callback: Promise<URLSearchParams>;
  #resolve!: (params: URLSearchParams) => void;
  #reject!: (error: Error) => void;
  #settled = false;
  #timeout: NodeJS.Timeout | null = null;

  private constructor(server: Server, port: number) {
    this.#server = server;
    this.redirectUrl = new URL(`${CALLBACK_PATH}`, `http://127.0.0.1:${port}`);
    this.#callback = new Promise<URLSearchParams>((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
    void this.#callback.catch(() => undefined);
    this.#timeout = setTimeout(
      () => this.fail(new Error("MCP_OAUTH_TIMEOUT")),
      OAUTH_TIMEOUT_MS,
    );
    this.#timeout.unref();
  }

  static async start(): Promise<OAuthCallbackListener> {
    let listener: OAuthCallbackListener | null = null;
    const server = createServer((request, response) => {
      if (!listener || request.method !== "GET" || !request.url) {
        response.writeHead(404).end("Not found");
        return;
      }
      const callback = new URL(request.url, listener.redirectUrl);
      if (callback.pathname !== CALLBACK_PATH) {
        response.writeHead(404).end("Not found");
        return;
      }
      response
        .writeHead(200, {
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'none'; style-src 'unsafe-inline'",
          "content-type": "text/html; charset=utf-8",
        })
        .end(
          "<!doctype html><meta charset=utf-8><title>Radius connected</title><style>body{font:16px system-ui;margin:48px;color:#202020}p{max-width:34rem;line-height:1.5}</style><h1>Return to Radius</h1><p>The authorization response was received. You can close this tab.</p>",
        );
      listener.succeed(callback.searchParams);
    });
    server.requestTimeout = 10_000;
    server.headersTimeout = 5_000;
    server.maxHeadersCount = 32;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("MCP_OAUTH_CALLBACK_UNAVAILABLE");
    }
    listener = new OAuthCallbackListener(server, address.port);
    return listener;
  }

  wait(): Promise<URLSearchParams> {
    return this.#callback;
  }

  succeed(params: URLSearchParams): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#resolve(params);
  }

  fail(error: Error): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#reject(error);
  }

  async close(): Promise<void> {
    if (this.#timeout) clearTimeout(this.#timeout);
    this.#timeout = null;
    if (!this.#settled) this.fail(new Error("MCP_OAUTH_CANCELLED"));
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }
}

export class VaultMcpOAuthProvider implements OAuthClientProvider {
  readonly #vault: CredentialVault;
  readonly #credentialRef: string;
  readonly #interactive: boolean;
  readonly #state = randomBytes(32).toString("base64url");
  readonly #redirectUrl: URL | undefined;
  #bundle = emptyBundle();
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(input: {
    vault: CredentialVault;
    credentialRef: string;
    redirectUrl?: URL;
    interactive: boolean;
  }) {
    this.#vault = input.vault;
    this.#credentialRef = input.credentialRef;
    this.#interactive = input.interactive;
    this.#redirectUrl = input.redirectUrl;
  }

  async initialize(): Promise<void> {
    this.#bundle = parseBundle(
      await this.#vault.getSecret(this.#credentialRef),
    );
  }

  get redirectUrl(): URL | undefined {
    return this.#redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    const redirectUrl =
      this.#redirectUrl ?? new URL("http://127.0.0.1/oauth/callback");
    return {
      client_name: "Radius",
      redirect_uris: [redirectUrl.toString()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state(): string {
    return this.#state;
  }

  clientInformation(
    context?: OAuthClientInformationContext,
  ): StoredOAuthClientInformation | undefined {
    const issuer = context?.issuer ?? this.#bundle.lastIssuer;
    const client = issuer ? this.#bundle.clients[issuer] : undefined;
    if (!client || !this.#interactive || !this.#redirectUrl) return client;
    return this.#bundle.clientRedirects[issuer!] ===
      this.#redirectUrl.toString()
      ? client
      : undefined;
  }

  async saveClientInformation(
    value: StoredOAuthClientInformation,
    context?: OAuthClientInformationContext,
  ): Promise<void> {
    const issuer = context?.issuer;
    if (!issuer) throw new Error("MCP_OAUTH_ISSUER_REQUIRED");
    await this.mutate((bundle) => {
      bundle.clients[issuer] = value;
      if (this.#redirectUrl) {
        bundle.clientRedirects[issuer] = this.#redirectUrl.toString();
      }
      bundle.lastIssuer = issuer;
    });
  }

  tokens(
    context?: OAuthClientInformationContext,
  ): StoredOAuthTokens | undefined {
    const issuer = context?.issuer ?? this.#bundle.lastIssuer;
    return issuer ? this.#bundle.tokens[issuer] : undefined;
  }

  async saveTokens(
    value: StoredOAuthTokens,
    context?: OAuthClientInformationContext,
  ): Promise<void> {
    const tokenIssuer = (value as { issuer?: unknown }).issuer;
    const issuer =
      context?.issuer ??
      (typeof tokenIssuer === "string" ? tokenIssuer : this.#bundle.lastIssuer);
    if (!issuer) throw new Error("MCP_OAUTH_ISSUER_REQUIRED");
    await this.mutate((bundle) => {
      bundle.tokens[issuer] = value;
      bundle.lastIssuer = issuer;
    });
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    if (!this.#interactive) throw new Error("MCP_AUTHENTICATION_REQUIRED");
    await shell.openExternal(url.toString());
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.mutate((bundle) => {
      bundle.codeVerifier = codeVerifier;
    });
  }

  codeVerifier(): string {
    if (!this.#bundle.codeVerifier) {
      throw new Error("MCP_OAUTH_CODE_VERIFIER_MISSING");
    }
    return this.#bundle.codeVerifier;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await this.mutate((bundle) => {
      bundle.discoveryState = state;
    });
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.#bundle.discoveryState ?? undefined;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    await this.mutate((bundle) => {
      if (scope === "all" || scope === "client") {
        bundle.clients = {};
        bundle.clientRedirects = {};
      }
      if (scope === "all" || scope === "tokens") bundle.tokens = {};
      if (scope === "all" || scope === "verifier") {
        bundle.codeVerifier = null;
      }
      if (scope === "all" || scope === "discovery") {
        bundle.discoveryState = null;
      }
      if (scope === "all") bundle.lastIssuer = null;
    });
  }

  hasTokens(): boolean {
    return Object.keys(this.#bundle.tokens).length > 0;
  }

  matchesState(value: string | null): boolean {
    return value === this.#state;
  }

  private async mutate(
    operation: (bundle: StoredMcpOAuthBundle) => void,
  ): Promise<void> {
    const pending = this.#mutationTail.then(async () => {
      operation(this.#bundle);
      await this.#vault.setSecret(
        this.#credentialRef,
        JSON.stringify(this.#bundle),
      );
    });
    this.#mutationTail = pending.catch(() => undefined);
    await pending;
  }
}

export async function connectInteractiveMcpClient(input: {
  endpoint: string;
  vault: CredentialVault;
  credentialRef: string;
}): Promise<{
  client: McpConnectorClient;
  credentialRef: string | null;
}> {
  const callback = await OAuthCallbackListener.start();
  const provider = new VaultMcpOAuthProvider({
    vault: input.vault,
    credentialRef: input.credentialRef,
    redirectUrl: callback.redirectUrl,
    interactive: true,
  });
  await provider.initialize();
  let client = new McpConnectorClient({
    endpoint: input.endpoint,
    authProvider: provider,
  });
  try {
    try {
      await client.connect();
    } catch (error) {
      if (!isMcpUnauthorizedError(error)) throw error;
      const params = await callback.wait();
      if (!provider.matchesState(params.get("state"))) {
        throw new Error("MCP_OAUTH_STATE_MISMATCH");
      }
      if (params.has("error") || !params.get("code")) {
        throw new Error("MCP_OAUTH_AUTHORIZATION_FAILED");
      }
      await client.finishAuth(params);
      await client.close();
      client = new McpConnectorClient({
        endpoint: input.endpoint,
        authProvider: provider,
      });
      await client.connect();
    }
    return {
      client,
      credentialRef: provider.hasTokens() ? input.credentialRef : null,
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  } finally {
    await callback.close();
  }
}

export async function createRuntimeMcpClient(input: {
  endpoint: string;
  vault: CredentialVault;
  credentialRef: string | null;
}): Promise<McpConnectorClient> {
  const authProvider = input.credentialRef
    ? new VaultMcpOAuthProvider({
        vault: input.vault,
        credentialRef: input.credentialRef,
        interactive: false,
      })
    : null;
  await authProvider?.initialize();
  return new McpConnectorClient({
    endpoint: input.endpoint,
    ...(authProvider ? { authProvider } : {}),
  });
}
