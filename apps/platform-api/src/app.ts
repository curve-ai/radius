import { randomUUID } from "node:crypto";

import { Hono, type Context } from "hono";

import { readCookie } from "./cookies.js";

import {
  CreateDeveloperTokenRequestSchema,
  UpdateOrganizationMembershipRequestSchema,
  PromoteAgentDeploymentRequestSchema,
  RevokeDeveloperTokenRequestSchema,
  RollbackAgentDeploymentRequestSchema,
  FinalizeAgentDeploymentRequestSchema,
  PlatformErrorResponseSchema,
  PrepareAgentDeploymentRequestSchema,
  ProvisionOrganizationRequestSchema,
  RegisterClientInstallationRequestSchema,
  ReportAgentInstallationRequestSchema,
  RADIUS_PLATFORM_API_VERSION,
  type FinalizeAgentDeploymentRequest,
  type FinalizeAgentDeploymentResponse,
  type AgentEnvironmentChangeResponse,
  type CreateDeveloperTokenRequest,
  type CreateDeveloperTokenResponse,
  type ListAgentEnvironmentHistoryResponse,
  type ListDeveloperTokensResponse,
  type ListOrganizationMembershipsResponse,
  type ListAgentsResponse,
  type ListAgentDeploymentsResponse,
  type PlatformIdentityResponse,
  type PrepareAgentDeploymentRequest,
  type PrepareAgentDeploymentResponse,
  type ProvisionOrganizationRequest,
  type ProvisionOrganizationResponse,
  type RegisterClientInstallationRequest,
  type RegisterClientInstallationResponse,
  type ReportAgentInstallationRequest,
  type ReportAgentInstallationResponse,
  type ListInstallationsResponse,
  type PromoteAgentDeploymentRequest,
  type RollbackAgentDeploymentRequest,
  type RevokeDeveloperTokenResponse,
  type UpdateOrganizationMembershipRequest,
  type UpdateOrganizationMembershipResponse,
} from "@curve-ai/platform-contracts";

export interface PlatformRequestIdentity {
  accountId: string;
  response: PlatformIdentityResponse;
}

export interface RadiusPlatformServices {
  authenticate(accessToken: string): Promise<PlatformRequestIdentity | null>;
  authenticateBrowserSession(
    sessionToken: string,
  ): Promise<PlatformRequestIdentity | null>;
  listOrganizationMemberships(options: {
    identity: PlatformRequestIdentity;
    organization: string;
  }): Promise<ListOrganizationMembershipsResponse>;
  updateOrganizationMembership(options: {
    identity: PlatformRequestIdentity;
    organization: string;
    membershipId: string;
    request: UpdateOrganizationMembershipRequest;
    idempotencyKey: string;
  }): Promise<UpdateOrganizationMembershipResponse>;
  listDeveloperTokens(options: {
    identity: PlatformRequestIdentity;
    organization: string;
  }): Promise<ListDeveloperTokensResponse>;
  createDeveloperToken(options: {
    identity: PlatformRequestIdentity;
    organization: string;
    request: CreateDeveloperTokenRequest;
    idempotencyKey: string;
  }): Promise<CreateDeveloperTokenResponse>;
  revokeDeveloperToken(options: {
    identity: PlatformRequestIdentity;
    organization: string;
    developerTokenId: string;
    idempotencyKey: string;
  }): Promise<RevokeDeveloperTokenResponse>;
  listAgents(options: {
    identity: PlatformRequestIdentity;
    organization: string;
  }): Promise<ListAgentsResponse>;
  listAgentDeployments(options: {
    identity: PlatformRequestIdentity;
    agent: string;
    limit: number;
    cursor: string | null;
  }): Promise<ListAgentDeploymentsResponse>;
  listAgentEnvironmentHistory(options: {
    identity: PlatformRequestIdentity;
    agent: string;
    environment: string;
    limit: number;
    cursor: string | null;
  }): Promise<ListAgentEnvironmentHistoryResponse>;
  prepareAgentDeployment(options: {
    identity: PlatformRequestIdentity;
    request: PrepareAgentDeploymentRequest;
    idempotencyKey: string;
  }): Promise<PrepareAgentDeploymentResponse>;
  finalizeAgentDeployment(options: {
    identity: PlatformRequestIdentity;
    agent: string;
    request: FinalizeAgentDeploymentRequest;
    idempotencyKey: string;
  }): Promise<FinalizeAgentDeploymentResponse>;
  promoteAgentDeployment(options: {
    identity: PlatformRequestIdentity;
    agent: string;
    environment: string;
    request: PromoteAgentDeploymentRequest;
    idempotencyKey: string;
  }): Promise<AgentEnvironmentChangeResponse>;
  rollbackAgentDeployment(options: {
    identity: PlatformRequestIdentity;
    agent: string;
    environment: string;
    request: RollbackAgentDeploymentRequest;
    idempotencyKey: string;
  }): Promise<AgentEnvironmentChangeResponse>;
  registerClientInstallation(options: {
    identity: PlatformRequestIdentity;
    clientInstanceId: string;
    request: RegisterClientInstallationRequest;
    idempotencyKey: string;
  }): Promise<RegisterClientInstallationResponse>;
  reportAgentInstallation(options: {
    identity: PlatformRequestIdentity;
    clientInstallationId: string;
    agent: string;
    request: ReportAgentInstallationRequest;
    idempotencyKey: string;
  }): Promise<ReportAgentInstallationResponse>;
  listInstallations(options: {
    identity: PlatformRequestIdentity;
    organization: string;
  }): Promise<ListInstallationsResponse>;
}

export interface PlatformBrowserAuthServices {
  sessionCookieName: string;
  oidc?: {
    transactionCookieName: string;
    clearTransactionCookie(): string;
    loginErrorUrl(requestUrl: URL): URL;
    begin(
      returnTo: string | undefined,
      requestUrl: URL,
    ): Promise<{ authorizationUrl: URL; setCookie: string }>;
    complete(
      callbackUrl: URL,
      transactionCookie: string,
    ): Promise<{
      identity: PlatformIdentityResponse;
      redirectUrl: URL;
      sessionCookie: string;
      clearTransactionCookie: string;
    }>;
  };
  authenticate(sessionToken: string): Promise<PlatformIdentityResponse | null>;
  organizationForRequest?(requestUrl: URL): Promise<string>;
  revoke(sessionToken: string): Promise<boolean>;
  clearSessionCookie(): string;
}

export interface PlatformProvisioningServices {
  authenticate(accessToken: string): Promise<boolean>;
  provisionOrganization(
    request: ProvisionOrganizationRequest,
  ): Promise<ProvisionOrganizationResponse>;
}

interface PlatformVariables {
  identity: PlatformRequestIdentity;
}

import type { PlatformDatabase } from "@curve-ai/platform-database";

import { createSyncRoutes } from "./sync/routes.js";

const MAX_JSON_BYTES = 1_048_576;

export function createPlatformApp(
  services: RadiusPlatformServices,
  options: {
    browserAuth?: PlatformBrowserAuthServices;
    provisioning?: PlatformProvisioningServices;
    deploymentMode?: "managed" | "self_hosted";
    // Conversation sync needs the database directly: it writes 27 projection
    // tables rather than going through the services interface.
    syncDatabase?: PlatformDatabase;
  } = {},
) {
  const app = new Hono<{ Variables: PlatformVariables }>();

  app.get("/health", (context) =>
    context.json({ ok: true, service: "radius-platform-api" }),
  );
  app.get("/api/platform/v1/info", (context) =>
    context.json({
      apiVersion: RADIUS_PLATFORM_API_VERSION,
      platformVersion: "0.0.1",
      deploymentModes: [options.deploymentMode ?? "self_hosted"] as const,
      supportedAgentConfigVersions: [1] as const,
      supportedAgentManifestVersions: [1] as const,
      registryUpload: true as const,
    }),
  );

  app.post("/api/platform/v1/internal/organizations", async (context) => {
    if (!options.provisioning) {
      throw new PlatformApiError(
        503,
        "PROVISIONING_NOT_CONFIGURED",
        "Organization provisioning is not configured",
      );
    }
    const token = readBearerToken(context.req.header("authorization"));
    if (!token || !(await options.provisioning.authenticate(token))) {
      throw new PlatformApiError(
        401,
        "UNAUTHORIZED",
        "Provisioning authentication required",
      );
    }
    const request = ProvisionOrganizationRequestSchema.parse(
      await boundedJson(context.req.raw),
    );
    const result = await options.provisioning.provisionOrganization(request);
    return context.json(result);
  });

  if (options.browserAuth) {
    const browserAuth = options.browserAuth;
    const oidc = browserAuth.oidc;
    if (oidc) {
      app.get("/api/platform/v1/auth/oidc/login", async (context) => {
        const requestUrl = new URL(context.req.url);
        const started = await oidc.begin(
          context.req.query("return_to"),
          requestUrl,
        );
        context.header("Set-Cookie", started.setCookie);
        return context.redirect(started.authorizationUrl.href, 302);
      });
      app.get("/api/platform/v1/auth/oidc/callback", async (context) => {
        const transaction = readCookie(
          context.req.header("cookie"),
          oidc.transactionCookieName,
        );
        if (!transaction) {
          return context.redirect(
            oidc.loginErrorUrl(new URL(context.req.url)).href,
            303,
          );
        }
        try {
          const completed = await oidc.complete(
            new URL(context.req.url),
            transaction,
          );
          context.header("Set-Cookie", completed.clearTransactionCookie);
          context.header("Set-Cookie", completed.sessionCookie, {
            append: true,
          });
          return context.redirect(completed.redirectUrl.href, 303);
        } catch {
          context.header("Set-Cookie", oidc.clearTransactionCookie());
          context.header("Set-Cookie", browserAuth.clearSessionCookie(), {
            append: true,
          });
          return context.redirect(
            oidc.loginErrorUrl(new URL(context.req.url)).href,
            303,
          );
        }
      });
    } else {
      app.all("/api/platform/v1/auth/oidc/*", () => {
        throw new PlatformApiError(
          503,
          "OIDC_NOT_CONFIGURED",
          "OIDC login is not configured",
        );
      });
    }
    app.get("/api/platform/v1/auth/session", async (context) => {
      const token = readCookie(
        context.req.header("cookie"),
        browserAuth.sessionCookieName,
      );
      if (!token) {
        throw new PlatformApiError(
          401,
          "UNAUTHORIZED",
          "Browser session required",
        );
      }
      const identity = await browserAuth.authenticate(token);
      if (!identity) {
        context.header("Set-Cookie", browserAuth.clearSessionCookie());
        throw new PlatformApiError(
          401,
          "UNAUTHORIZED",
          "Browser session is invalid",
        );
      }
      return context.json(
        await requireRequestOrganization(
          browserAuth,
          new URL(context.req.url),
          identity,
        ),
      );
    });
    app.post("/api/platform/v1/auth/logout", async (context) => {
      const token = readCookie(
        context.req.header("cookie"),
        browserAuth.sessionCookieName,
      );
      if (token) await browserAuth.revoke(token);
      context.header("Set-Cookie", browserAuth.clearSessionCookie());
      return context.json({ apiVersion: 1, loggedOut: true });
    });
  } else {
    app.all("/api/platform/v1/auth/*", () => {
      throw new PlatformApiError(
        503,
        "OIDC_NOT_CONFIGURED",
        "Browser authentication is not configured",
      );
    });
  }

  app.use("/api/platform/v1/*", async (context, next) => {
    const token = readBearerToken(context.req.header("authorization"));
    const sessionToken = options.browserAuth
      ? readCookie(
          context.req.header("cookie"),
          options.browserAuth.sessionCookieName,
        )
      : null;
    if (!token && !sessionToken) {
      return platformError(
        context,
        401,
        "UNAUTHORIZED",
        "Authentication required",
      );
    }
    const identity = token
      ? await services.authenticate(token)
      : await services.authenticateBrowserSession(sessionToken!);
    if (!identity)
      return platformError(
        context,
        401,
        "UNAUTHORIZED",
        "Invalid authentication",
      );
    const scopedIdentity =
      options.browserAuth?.organizationForRequest
        ? {
            ...identity,
            response: await requireRequestOrganization(
              options.browserAuth,
              new URL(context.req.url),
              identity.response,
            ),
          }
        : identity;
    context.set("identity", scopedIdentity);
    await next();
  });

  // Mounted after the identity middleware so every sync route already has an
  // authenticated, organization-scoped caller.
  if (options.syncDatabase) {
    app.route("/api/platform/v1/sync", createSyncRoutes(options.syncDatabase));
  }

  app.get("/api/platform/v1/identity", (context) =>
    context.json(context.get("identity").response),
  );

  app.get(
    "/api/platform/v1/organizations/:organization/memberships",
    async (context) => {
      const result = await services.listOrganizationMemberships({
        identity: context.get("identity"),
        organization: context.req.param("organization"),
      });
      return context.json(result);
    },
  );

  app.post(
    "/api/platform/v1/organizations/:organization/memberships/:membershipId",
    async (context) => {
      const idempotencyKey = requireIdempotencyKey(
        context.req.header("idempotency-key"),
      );
      const request = UpdateOrganizationMembershipRequestSchema.parse(
        await boundedJson(context.req.raw),
      );
      const result = await services.updateOrganizationMembership({
        identity: context.get("identity"),
        organization: context.req.param("organization"),
        membershipId: context.req.param("membershipId"),
        request,
        idempotencyKey,
      });
      return context.json(result);
    },
  );

  app.get(
    "/api/platform/v1/organizations/:organization/developer-tokens",
    async (context) => {
      const result = await services.listDeveloperTokens({
        identity: context.get("identity"),
        organization: context.req.param("organization"),
      });
      return context.json(result);
    },
  );

  app.post(
    "/api/platform/v1/organizations/:organization/developer-tokens",
    async (context) => {
      const idempotencyKey = requireIdempotencyKey(
        context.req.header("idempotency-key"),
      );
      const request = CreateDeveloperTokenRequestSchema.parse(
        await boundedJson(context.req.raw),
      );
      const result = await services.createDeveloperToken({
        identity: context.get("identity"),
        organization: context.req.param("organization"),
        request,
        idempotencyKey,
      });
      return context.json(result, 201);
    },
  );

  app.post(
    "/api/platform/v1/organizations/:organization/developer-tokens/:developerTokenId/revoke",
    async (context) => {
      const idempotencyKey = requireIdempotencyKey(
        context.req.header("idempotency-key"),
      );
      RevokeDeveloperTokenRequestSchema.parse(
        await boundedJson(context.req.raw),
      );
      const result = await services.revokeDeveloperToken({
        identity: context.get("identity"),
        organization: context.req.param("organization"),
        developerTokenId: context.req.param("developerTokenId"),
        idempotencyKey,
      });
      return context.json(result);
    },
  );

  app.get(
    "/api/platform/v1/organizations/:organization/agents",
    async (context) => {
      const result = await services.listAgents({
        identity: context.get("identity"),
        organization: context.req.param("organization"),
      });
      return context.json(result);
    },
  );

  app.get("/api/platform/v1/agents/:agent/deployments", async (context) => {
    const page = parsePagination(
      context.req.query("limit"),
      context.req.query("cursor"),
    );
    const result = await services.listAgentDeployments({
      identity: context.get("identity"),
      agent: context.req.param("agent"),
      ...page,
    });
    return context.json(result);
  });

  app.get(
    "/api/platform/v1/agents/:agent/environments/:environment/deployments",
    async (context) => {
      const page = parsePagination(
        context.req.query("limit"),
        context.req.query("cursor"),
      );
      const result = await services.listAgentEnvironmentHistory({
        identity: context.get("identity"),
        agent: context.req.param("agent"),
        environment: context.req.param("environment"),
        ...page,
      });
      return context.json(result);
    },
  );

  app.post(
    "/api/platform/v1/agents/:agent/deployments/prepare",
    async (context) => {
      const idempotencyKey = requireIdempotencyKey(
        context.req.header("idempotency-key"),
      );
      const request = PrepareAgentDeploymentRequestSchema.parse(
        await boundedJson(context.req.raw),
      );
      if (request.agent !== context.req.param("agent")) {
        return platformError(
          context,
          400,
          "AGENT_MISMATCH",
          "Agent path and body must match",
        );
      }
      const result = await services.prepareAgentDeployment({
        identity: context.get("identity"),
        request,
        idempotencyKey,
      });
      return context.json(result, 201);
    },
  );

  app.post(
    "/api/platform/v1/agents/:agent/environments/:environment/deployments/promote",
    async (context) => {
      const idempotencyKey = requireIdempotencyKey(
        context.req.header("idempotency-key"),
      );
      const request = PromoteAgentDeploymentRequestSchema.parse(
        await boundedJson(context.req.raw),
      );
      const result = await services.promoteAgentDeployment({
        identity: context.get("identity"),
        agent: context.req.param("agent"),
        environment: context.req.param("environment"),
        request,
        idempotencyKey,
      });
      return context.json(result);
    },
  );

  app.post(
    "/api/platform/v1/agents/:agent/environments/:environment/deployments/rollback",
    async (context) => {
      const idempotencyKey = requireIdempotencyKey(
        context.req.header("idempotency-key"),
      );
      const request = RollbackAgentDeploymentRequestSchema.parse(
        await boundedJson(context.req.raw),
      );
      const result = await services.rollbackAgentDeployment({
        identity: context.get("identity"),
        agent: context.req.param("agent"),
        environment: context.req.param("environment"),
        request,
        idempotencyKey,
      });
      return context.json(result);
    },
  );

  app.post(
    "/api/platform/v1/agents/:agent/deployments/finalize",
    async (context) => {
      const idempotencyKey = requireIdempotencyKey(
        context.req.header("idempotency-key"),
      );
      const request = FinalizeAgentDeploymentRequestSchema.parse(
        await boundedJson(context.req.raw),
      );
      const result = await services.finalizeAgentDeployment({
        identity: context.get("identity"),
        agent: context.req.param("agent"),
        request,
        idempotencyKey,
      });
      return context.json(result);
    },
  );

  app.put(
    "/api/platform/v1/client-installations/:clientInstanceId",
    async (context) => {
      const idempotencyKey = requireIdempotencyKey(
        context.req.header("idempotency-key"),
      );
      const request = RegisterClientInstallationRequestSchema.parse(
        await boundedJson(context.req.raw),
      );
      if (request.clientInstanceId !== context.req.param("clientInstanceId")) {
        return platformError(
          context,
          400,
          "CLIENT_INSTALLATION_MISMATCH",
          "Client installation path and body must match",
        );
      }
      const result = await services.registerClientInstallation({
        identity: context.get("identity"),
        clientInstanceId: context.req.param("clientInstanceId"),
        request,
        idempotencyKey,
      });
      return context.json(result);
    },
  );

  app.post(
    "/api/platform/v1/client-installations/:clientInstallationId/agents/:agent/observations",
    async (context) => {
      const idempotencyKey = requireIdempotencyKey(
        context.req.header("idempotency-key"),
      );
      const request = ReportAgentInstallationRequestSchema.parse(
        await boundedJson(context.req.raw),
      );
      const result = await services.reportAgentInstallation({
        identity: context.get("identity"),
        clientInstallationId: context.req.param("clientInstallationId"),
        agent: context.req.param("agent"),
        request,
        idempotencyKey,
      });
      return context.json(result);
    },
  );

  app.get(
    "/api/platform/v1/organizations/:organization/installations",
    async (context) => {
      const result = await services.listInstallations({
        identity: context.get("identity"),
        organization: context.req.param("organization"),
      });
      return context.json(result);
    },
  );

  app.onError((error, context) => {
    if (error instanceof PlatformApiError) {
      return platformError(context, error.status, error.code, error.message);
    }
    if (error && typeof error === "object" && "issues" in error) {
      return platformError(
        context,
        400,
        "INVALID_REQUEST",
        "Request validation failed",
      );
    }
    console.error("Radius Platform request failed", error);
    return platformError(
      context,
      500,
      "INTERNAL_ERROR",
      "Internal Platform error",
    );
  });

  return app;
}

async function requireRequestOrganization(
  browserAuth: PlatformBrowserAuthServices,
  requestUrl: URL,
  identity: PlatformIdentityResponse,
): Promise<PlatformIdentityResponse> {
  if (!browserAuth.organizationForRequest) return identity;
  const organization = await browserAuth.organizationForRequest(requestUrl);
  const membership = identity.organizations.find(
    (candidate) => candidate.slug === organization,
  );
  if (!membership) {
    throw new PlatformApiError(
      403,
      "ORGANIZATION_HOST_MISMATCH",
      "Authenticated identity does not belong to this organization",
    );
  }
  return { ...identity, organizations: [membership] };
}

function readBearerToken(authorization: string | undefined): string | null {
  return authorization?.match(/^Bearer ([^\s]+)$/)?.[1] ?? null;
}

export class PlatformApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function boundedJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
    throw new PlatformApiError(
      413,
      "PAYLOAD_TOO_LARGE",
      "JSON body exceeds 1 MiB",
    );
  }
  const text = await readBoundedText(
    request.body,
    MAX_JSON_BYTES,
    () =>
      new PlatformApiError(413, "PAYLOAD_TOO_LARGE", "JSON body exceeds 1 MiB"),
  );
  try {
    return JSON.parse(text);
  } catch {
    throw new PlatformApiError(
      400,
      "INVALID_JSON",
      "Request body must be JSON",
    );
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

function requireIdempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9._:-]{8,240}$/.test(value)) {
    throw new PlatformApiError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid idempotency-key header is required",
    );
  }
  return value;
}

function parsePagination(
  limitValue: string | undefined,
  cursorValue: string | undefined,
): { limit: number; cursor: string | null } {
  const limit = limitValue === undefined ? 50 : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new PlatformApiError(
      400,
      "INVALID_PAGE_LIMIT",
      "Page limit must be an integer from 1 to 100",
    );
  }
  if (
    cursorValue !== undefined &&
    (cursorValue.length < 1 || cursorValue.length > 512)
  ) {
    throw new PlatformApiError(400, "INVALID_CURSOR", "Cursor is invalid");
  }
  return { limit, cursor: cursorValue ?? null };
}

function platformError(
  context: Context,
  status: number,
  code: string,
  message: string,
) {
  const payload = PlatformErrorResponseSchema.parse({
    apiVersion: RADIUS_PLATFORM_API_VERSION,
    error: { code, message, requestId: randomUUID() },
  });
  return context.json(payload, status as never);
}
