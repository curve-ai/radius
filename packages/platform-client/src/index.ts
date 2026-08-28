import type { z } from "zod";

import {
  DEVELOPER_TOKEN_SCOPES,
  PLATFORM_ORGANIZATION_ROLES,
  CreateDeveloperTokenRequestSchema,
  CreateDeveloperTokenResponseSchema,
  AgentEnvironmentChangeResponseSchema,
  FinalizeAgentDeploymentRequestSchema,
  FinalizeAgentDeploymentResponseSchema,
  ListAgentEnvironmentHistoryResponseSchema,
  ListDeveloperTokensResponseSchema,
  ListOrganizationMembershipsResponseSchema,
  ListAgentsResponseSchema,
  ListAgentDeploymentsResponseSchema,
  ListInstallationsResponseSchema,
  PlatformErrorResponseSchema,
  PlatformIdentityResponseSchema,
  PlatformInfoResponseSchema,
  PromoteAgentDeploymentRequestSchema,
  PrepareAgentDeploymentRequestSchema,
  PrepareAgentDeploymentResponseSchema,
  RegisterClientInstallationRequestSchema,
  RegisterClientInstallationResponseSchema,
  ReportAgentInstallationRequestSchema,
  ReportAgentInstallationResponseSchema,
  RollbackAgentDeploymentRequestSchema,
  RevokeDeveloperTokenRequestSchema,
  RevokeDeveloperTokenResponseSchema,
  UpdateOrganizationMembershipRequestSchema,
  UpdateOrganizationMembershipResponseSchema,
  type CreateDeveloperTokenRequest,
  type CreateDeveloperTokenResponse,
  type AgentEnvironmentChangeResponse,
  type FinalizeAgentDeploymentRequest,
  type FinalizeAgentDeploymentResponse,
  type ListAgentEnvironmentHistoryResponse,
  type ListDeveloperTokensResponse,
  type ListOrganizationMembershipsResponse,
  type ListAgentsResponse,
  type ListAgentDeploymentsResponse,
  type ListInstallationsResponse,
  type PlatformIdentityResponse,
  type PlatformInfoResponse,
  type PromoteAgentDeploymentRequest,
  type PrepareAgentDeploymentRequest,
  type PrepareAgentDeploymentResponse,
  type RegisterClientInstallationRequest,
  type RegisterClientInstallationResponse,
  type ReportAgentInstallationRequest,
  type ReportAgentInstallationResponse,
  type RollbackAgentDeploymentRequest,
  type RevokeDeveloperTokenResponse,
  type UpdateOrganizationMembershipRequest,
  type UpdateOrganizationMembershipResponse,
} from "@curve-ai/platform-contracts";

export { DEVELOPER_TOKEN_SCOPES, PLATFORM_ORGANIZATION_ROLES };

export interface RadiusPlatformClientOptions {
  baseUrl: string;
  accessToken?: string;
  cookie?: string;
  fetch?: typeof globalThis.fetch;
  allowInsecureHttp?: boolean;
}

export interface PlatformPageOptions {
  limit?: number;
  cursor?: string;
}

const MAX_JSON_BYTES = 1_048_576;

export class RadiusPlatformClient {
  readonly baseUrl: URL;
  private readonly accessToken?: string;
  private readonly cookie?: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(options: RadiusPlatformClientOptions) {
    this.baseUrl = validatePlatformBaseUrl(options.baseUrl, {
      allowInsecureHttp: options.allowInsecureHttp,
    });
    this.accessToken = options.accessToken?.trim() || undefined;
    this.cookie = options.cookie?.trim() || undefined;
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  info(signal?: AbortSignal): Promise<PlatformInfoResponse> {
    return this.request(
      "GET",
      "/api/platform/v1/info",
      PlatformInfoResponseSchema,
      {
        signal,
        authenticated: false,
      },
    );
  }

  identity(signal?: AbortSignal): Promise<PlatformIdentityResponse> {
    return this.request(
      "GET",
      "/api/platform/v1/identity",
      PlatformIdentityResponseSchema,
      { signal, authenticated: true },
    );
  }

  browserSessionIdentity(
    signal?: AbortSignal,
  ): Promise<PlatformIdentityResponse> {
    return this.request(
      "GET",
      "/api/platform/v1/auth/session",
      PlatformIdentityResponseSchema,
      { signal, authenticated: false },
    );
  }

  listOrganizationMemberships(
    organization: string,
    signal?: AbortSignal,
  ): Promise<ListOrganizationMembershipsResponse> {
    return this.request(
      "GET",
      `/api/platform/v1/organizations/${encodeURIComponent(organization)}/memberships`,
      ListOrganizationMembershipsResponseSchema,
      { signal, authenticated: true },
    );
  }

  updateOrganizationMembership(
    organization: string,
    membershipId: string,
    request: UpdateOrganizationMembershipRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<UpdateOrganizationMembershipResponse> {
    return this.request(
      "POST",
      `/api/platform/v1/organizations/${encodeURIComponent(organization)}/memberships/${encodeURIComponent(membershipId)}`,
      UpdateOrganizationMembershipResponseSchema,
      {
        body: UpdateOrganizationMembershipRequestSchema.parse(request),
        signal,
        authenticated: true,
        idempotencyKey,
      },
    );
  }

  listDeveloperTokens(
    organization: string,
    signal?: AbortSignal,
  ): Promise<ListDeveloperTokensResponse> {
    return this.request(
      "GET",
      `/api/platform/v1/organizations/${encodeURIComponent(organization)}/developer-tokens`,
      ListDeveloperTokensResponseSchema,
      { signal, authenticated: true },
    );
  }

  createDeveloperToken(
    organization: string,
    request: CreateDeveloperTokenRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<CreateDeveloperTokenResponse> {
    return this.request(
      "POST",
      `/api/platform/v1/organizations/${encodeURIComponent(organization)}/developer-tokens`,
      CreateDeveloperTokenResponseSchema,
      {
        body: CreateDeveloperTokenRequestSchema.parse(request),
        signal,
        authenticated: true,
        idempotencyKey,
      },
    );
  }

  revokeDeveloperToken(
    organization: string,
    tokenId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<RevokeDeveloperTokenResponse> {
    return this.request(
      "POST",
      `/api/platform/v1/organizations/${encodeURIComponent(organization)}/developer-tokens/${encodeURIComponent(tokenId)}/revoke`,
      RevokeDeveloperTokenResponseSchema,
      {
        body: RevokeDeveloperTokenRequestSchema.parse({ apiVersion: 1 }),
        signal,
        authenticated: true,
        idempotencyKey,
      },
    );
  }

  listAgents(
    organization: string,
    signal?: AbortSignal,
  ): Promise<ListAgentsResponse> {
    return this.request(
      "GET",
      `/api/platform/v1/organizations/${encodeURIComponent(organization)}/agents`,
      ListAgentsResponseSchema,
      { signal, authenticated: true },
    );
  }

  listAgentDeployments(
    agent: string,
    page: PlatformPageOptions = {},
    signal?: AbortSignal,
  ): Promise<ListAgentDeploymentsResponse> {
    return this.request(
      "GET",
      paginatedPath(
        `/api/platform/v1/agents/${encodeURIComponent(agent)}/deployments`,
        page,
      ),
      ListAgentDeploymentsResponseSchema,
      { signal, authenticated: true },
    );
  }

  listAgentEnvironmentHistory(
    agent: string,
    environment: string,
    page: PlatformPageOptions = {},
    signal?: AbortSignal,
  ): Promise<ListAgentEnvironmentHistoryResponse> {
    return this.request(
      "GET",
      paginatedPath(
        `/api/platform/v1/agents/${encodeURIComponent(agent)}/environments/${encodeURIComponent(environment)}/deployments`,
        page,
      ),
      ListAgentEnvironmentHistoryResponseSchema,
      { signal, authenticated: true },
    );
  }

  prepareAgentDeployment(
    request: PrepareAgentDeploymentRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<PrepareAgentDeploymentResponse> {
    return this.request(
      "POST",
      `/api/platform/v1/agents/${encodeURIComponent(request.agent)}/deployments/prepare`,
      PrepareAgentDeploymentResponseSchema,
      {
        body: PrepareAgentDeploymentRequestSchema.parse(request),
        signal,
        authenticated: true,
        idempotencyKey,
      },
    );
  }

  finalizeAgentDeployment(
    agent: string,
    request: FinalizeAgentDeploymentRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<FinalizeAgentDeploymentResponse> {
    return this.request(
      "POST",
      `/api/platform/v1/agents/${encodeURIComponent(agent)}/deployments/finalize`,
      FinalizeAgentDeploymentResponseSchema,
      {
        body: FinalizeAgentDeploymentRequestSchema.parse(request),
        signal,
        authenticated: true,
        idempotencyKey,
      },
    );
  }

  promoteAgentDeployment(
    agent: string,
    environment: string,
    request: PromoteAgentDeploymentRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<AgentEnvironmentChangeResponse> {
    return this.request(
      "POST",
      `/api/platform/v1/agents/${encodeURIComponent(agent)}/environments/${encodeURIComponent(environment)}/deployments/promote`,
      AgentEnvironmentChangeResponseSchema,
      {
        body: PromoteAgentDeploymentRequestSchema.parse(request),
        signal,
        authenticated: true,
        idempotencyKey,
      },
    );
  }

  rollbackAgentDeployment(
    agent: string,
    environment: string,
    request: RollbackAgentDeploymentRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<AgentEnvironmentChangeResponse> {
    return this.request(
      "POST",
      `/api/platform/v1/agents/${encodeURIComponent(agent)}/environments/${encodeURIComponent(environment)}/deployments/rollback`,
      AgentEnvironmentChangeResponseSchema,
      {
        body: RollbackAgentDeploymentRequestSchema.parse(request),
        signal,
        authenticated: true,
        idempotencyKey,
      },
    );
  }

  registerClientInstallation(
    clientInstanceId: string,
    request: RegisterClientInstallationRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<RegisterClientInstallationResponse> {
    return this.request(
      "PUT",
      `/api/platform/v1/client-installations/${encodeURIComponent(clientInstanceId)}`,
      RegisterClientInstallationResponseSchema,
      {
        body: RegisterClientInstallationRequestSchema.parse(request),
        signal,
        authenticated: true,
        idempotencyKey,
      },
    );
  }

  reportAgentInstallation(
    clientInstallationId: string,
    agent: string,
    request: ReportAgentInstallationRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ReportAgentInstallationResponse> {
    return this.request(
      "POST",
      `/api/platform/v1/client-installations/${encodeURIComponent(clientInstallationId)}/agents/${encodeURIComponent(agent)}/observations`,
      ReportAgentInstallationResponseSchema,
      {
        body: ReportAgentInstallationRequestSchema.parse(request),
        signal,
        authenticated: true,
        idempotencyKey,
      },
    );
  }

  listInstallations(
    organization: string,
    signal?: AbortSignal,
  ): Promise<ListInstallationsResponse> {
    return this.request(
      "GET",
      `/api/platform/v1/organizations/${encodeURIComponent(organization)}/installations`,
      ListInstallationsResponseSchema,
      { signal, authenticated: true },
    );
  }

  private async request<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    options: {
      body?: unknown;
      signal?: AbortSignal;
      authenticated: boolean;
      idempotencyKey?: string;
    },
  ): Promise<T> {
    if (options.authenticated && !this.accessToken && !this.cookie) {
      throw new Error("Radius Platform authentication is required");
    }
    const headers = new Headers({ accept: "application/json" });
    if (options.body !== undefined)
      headers.set("content-type", "application/json");
    if (this.accessToken && options.authenticated) {
      headers.set("authorization", `Bearer ${this.accessToken}`);
    }
    if (this.cookie) headers.set("cookie", this.cookie);
    if (options.idempotencyKey) {
      headers.set("idempotency-key", options.idempotencyKey);
    }

    const response = await this.fetcher(new URL(path, this.baseUrl), {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
    const declaredLength = Number(
      response.headers.get("content-length") ?? "0",
    );
    if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
      throw new Error("Radius Platform response exceeded 1 MiB");
    }
    const text = await readBoundedText(
      response.body,
      MAX_JSON_BYTES,
      () => new Error("Radius Platform response exceeded 1 MiB"),
    );
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(
        `Radius Platform returned invalid JSON (${response.status})`,
      );
    }
    if (!response.ok) {
      const parsed = PlatformErrorResponseSchema.safeParse(payload);
      if (parsed.success) {
        throw new RadiusPlatformError(
          response.status,
          parsed.data.error.code,
          parsed.data.error.message,
          parsed.data.error.requestId,
        );
      }
      throw new Error(`Radius Platform request failed with ${response.status}`);
    }
    return schema.parse(payload);
  }
}

async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  overflow: () => Error,
): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw overflow();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export class RadiusPlatformError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "RadiusPlatformError";
  }
}

export function validatePlatformBaseUrl(
  value: string,
  options: { allowInsecureHttp?: boolean } = {},
): URL {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && (loopback || options.allowInsecureHttp))
  ) {
    throw new Error(
      "Radius Platform URL must use HTTPS except for loopback development",
    );
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function paginatedPath(path: string, page: PlatformPageOptions): string {
  const search = new URLSearchParams();
  if (page.limit !== undefined) {
    if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > 100) {
      throw new Error(
        "Radius Platform page limit must be an integer from 1 to 100",
      );
    }
    search.set("limit", String(page.limit));
  }
  if (page.cursor !== undefined) {
    if (!page.cursor || page.cursor.length > 512) {
      throw new Error("Radius Platform cursor is invalid");
    }
    search.set("cursor", page.cursor);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export type {
  AgentSummary,
  CreateDeveloperTokenRequest,
  CreateDeveloperTokenResponse,
  DeveloperTokenScope,
  DeveloperTokenSummary,
  AgentEnvironmentChangeResponse,
  AgentEnvironmentRevisionSummary,
  FinalizeAgentDeploymentRequest,
  FinalizeAgentDeploymentResponse,
  ListAgentEnvironmentHistoryResponse,
  ListDeveloperTokensResponse,
  ListOrganizationMembershipsResponse,
  ListAgentsResponse,
  ListAgentDeploymentsResponse,
  ListInstallationsResponse,
  PlatformIdentityResponse,
  PlatformInfoResponse,
  PromoteAgentDeploymentRequest,
  PrepareAgentDeploymentRequest,
  PrepareAgentDeploymentResponse,
  RegisterClientInstallationRequest,
  RegisterClientInstallationResponse,
  ReportAgentInstallationRequest,
  ReportAgentInstallationResponse,
  AgentDeploymentSummary,
  RollbackAgentDeploymentRequest,
  RevokeDeveloperTokenResponse,
  OrganizationMembershipLifecycle,
  OrganizationMembershipSummary,
  PlatformOrganizationRole,
  UpdateOrganizationMembershipRequest,
  UpdateOrganizationMembershipResponse,
} from "@curve-ai/platform-contracts";
