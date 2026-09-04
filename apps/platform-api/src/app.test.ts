import assert from "node:assert/strict";
import test from "node:test";

import type { RadiusPlatformServices } from "./app.js";
import { createPlatformApp } from "./app.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const uploadId = "22222222-2222-4222-8222-222222222222";
const agentDeploymentId = "33333333-3333-4333-8333-333333333333";
const clientInstallationId = "77777777-7777-4777-8777-777777777777";
const organizationId = "12121212-1212-4212-8212-121212121212";

function services(): RadiusPlatformServices {
  return {
    authenticate: async (token) =>
      token === "valid"
        ? {
            accountId,
            response: { apiVersion: 1, accountId, organizations: [] },
          }
        : null,
    authenticateBrowserSession: async () => null,
    listOrganizationMemberships: async ({ organization }) => ({
      apiVersion: 1,
      organization,
      memberships: [],
    }),
    updateOrganizationMembership: async ({
      organization,
      membershipId,
      request,
    }) => ({
      apiVersion: 1,
      organization,
      membership: {
        id: membershipId,
        accountId: "55555555-5555-4555-8555-555555555555",
        displayName: "Build Engineer",
        email: "build@example.com",
        role: request.role ?? "viewer",
        lifecycleState: request.lifecycleState ?? "active",
        joinedAt: "2026-08-26T12:00:00.000Z",
        updatedAt: "2026-08-26T13:00:00.000Z",
        developerTokenCount: 0,
        current: false,
      },
    }),
    listDeveloperTokens: async ({ organization }) => ({
      apiVersion: 1,
      organization,
      tokens: [],
    }),
    createDeveloperToken: async ({ request }) => ({
      apiVersion: 1,
      token: {
        id: "44444444-4444-4444-8444-444444444444",
        label: request.label,
        prefix: "radius_pat_abcde",
        scopes: request.scopes,
        createdAt: "2026-08-26T12:00:00.000Z",
        lastUsedAt: null,
        expiresAt: request.expiresAt,
        revokedAt: null,
        current: false,
      },
      secret: `radius_pat_${"a".repeat(43)}`,
    }),
    revokeDeveloperToken: async () => ({
      apiVersion: 1,
      token: {
        id: "44444444-4444-4444-8444-444444444444",
        label: "CI",
        prefix: "radius_pat_abcde",
        scopes: ["deployment.write"],
        createdAt: "2026-08-26T12:00:00.000Z",
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: "2026-08-26T13:00:00.000Z",
        current: false,
      },
    }),
    listAgents: async ({ organization }) => ({
      apiVersion: 1,
      organization,
      agents: [],
    }),
    listAgentDeployments: async ({ agent }) => ({
      apiVersion: 1,
      agent,
      agentDeployments: [],
      nextCursor: null,
    }),
    listAgentEnvironmentHistory: async ({ agent, environment }) => ({
      apiVersion: 1,
      agent,
      environment,
      currentRevision: 0,
      revisions: [],
      nextCursor: null,
    }),
    prepareAgentDeployment: async ({ request }) => ({
      apiVersion: 1,
      uploadId,
      imageReference: `registry.example/${request.agent}/agent:upload`,
      credentials: {
        registry: "registry.example",
        username: "upload",
        password: "short-lived",
        expiresAt: "2026-08-25T23:00:00.000Z",
      },
    }),
    finalizeAgentDeployment: async ({ request }) => ({
      apiVersion: 1,
      agentDeployment: {
        id: agentDeploymentId,
        version: "20260825.1",
        imageDigest: request.imageDigest,
        state: "verified",
      },
      environmentRevision: null,
    }),
    promoteAgentDeployment: async ({ environment, request }) => ({
      apiVersion: 1,
      environmentRevision: {
        environment,
        revision: 2,
        agentDeploymentId: request.agentDeploymentId,
        previousAgentDeploymentId: null,
      },
    }),
    rollbackAgentDeployment: async ({ environment, request }) => ({
      apiVersion: 1,
      environmentRevision: {
        environment,
        revision: request.expectedDeploymentRevision + 1,
        agentDeploymentId: request.agentDeploymentId,
        previousAgentDeploymentId: null,
      },
    }),
    registerClientInstallation: async () => ({
      apiVersion: 1,
      physicalDeviceId: "88888888-8888-4888-8888-888888888888",
      clientInstallationId,
    }),
    reportAgentInstallation: async () => ({
      apiVersion: 1,
      agentInstallationId: "99999999-9999-4999-8999-999999999999",
      observationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }),
    listInstallations: async ({ organization }) => ({
      apiVersion: 1,
      organization,
      physicalDevices: [],
    }),
  };
}

test("serves current Platform capabilities without authentication", async () => {
  const response = await createPlatformApp(services()).request(
    "/api/platform/v1/info",
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).registryUpload, true);
});

test("provisions an organization only through the internal provisioning boundary", async () => {
  const app = createPlatformApp(services(), {
    provisioning: {
      authenticate: async (token) => token === "provisioning-secret",
      provisionOrganization: async (request) => ({
        apiVersion: 1,
        organizationId: request.organization.id,
        accountId: request.owner.accountId,
        accountIdentityId: "13131313-1313-4313-8313-131313131313",
        membershipId: "14141414-1414-4414-8414-141414141414",
      }),
    },
  });
  const body = JSON.stringify({
    apiVersion: 1,
    organization: {
      id: organizationId,
      slug: "acme",
      displayName: "Acme",
    },
    owner: {
      accountId,
      displayName: "Platform Owner",
      identity: {
        issuer: "https://auth.curvehq.sh",
        subject: "better-auth-user-1",
        email: "owner@acme.example",
        emailVerified: true,
      },
    },
  });
  const unauthorized = await app.request(
    "/api/platform/v1/internal/organizations",
    {
      method: "POST",
      headers: {
        authorization: "Bearer no",
        "content-type": "application/json",
      },
      body,
    },
  );
  assert.equal(unauthorized.status, 401);

  const response = await app.request(
    "/api/platform/v1/internal/organizations",
    {
      method: "POST",
      headers: {
        authorization: "Bearer provisioning-secret",
        "content-type": "application/json",
      },
      body,
    },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).organizationId, organizationId);
});

test("requires bearer authentication for identity", async () => {
  const response = await createPlatformApp(services()).request(
    "/api/platform/v1/identity",
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "UNAUTHORIZED");
});

test("reports unconfigured browser authentication without bearer middleware", async () => {
  const response = await createPlatformApp(services()).request(
    "/api/platform/v1/auth/oidc/login",
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "OIDC_NOT_CONFIGURED");
});

test("keeps OIDC redirects and browser sessions outside bearer middleware", async () => {
  const app = createPlatformApp(services(), {
    browserAuth: {
      sessionCookieName: "radius_platform_session",
      clearSessionCookie: () => "radius_platform_session=; Max-Age=0",
      oidc: {
        transactionCookieName: "radius_oidc_transaction",
        clearTransactionCookie: () => "radius_oidc_transaction=; Max-Age=0",
        loginErrorUrl: () =>
          new URL("https://platform.example.com/login?error=oidc"),
        begin: async () => ({
          authorizationUrl: new URL("https://id.example.com/authorize"),
          setCookie: "radius_oidc_transaction=sealed; HttpOnly",
        }),
        complete: async () => ({
          identity: { apiVersion: 1, accountId, organizations: [] },
          redirectUrl: new URL("https://platform.example.com/workspace"),
          sessionCookie: "radius_platform_session=session; HttpOnly",
          clearTransactionCookie: "radius_oidc_transaction=; Max-Age=0",
        }),
      },
      authenticate: async (token) =>
        token === "session"
          ? { apiVersion: 1, accountId, organizations: [] }
          : null,
      revoke: async () => true,
    },
  });
  const login = await app.request("/api/platform/v1/auth/oidc/login");
  assert.equal(login.status, 302);
  assert.equal(
    login.headers.get("location"),
    "https://id.example.com/authorize",
  );
  assert.match(
    login.headers.get("set-cookie") ?? "",
    /radius_oidc_transaction/,
  );

  const callback = await app.request(
    "/api/platform/v1/auth/oidc/callback?code=code&state=state",
    { headers: { cookie: "radius_oidc_transaction=sealed" } },
  );
  assert.equal(callback.status, 303);
  assert.equal(
    callback.headers.get("location"),
    "https://platform.example.com/workspace",
  );
  assert.match(
    callback.headers.get("set-cookie") ?? "",
    /radius_platform_session/,
  );

  const session = await app.request("/api/platform/v1/auth/session", {
    headers: { cookie: "radius_platform_session=session" },
  });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).accountId, accountId);
});

test("fails closed when a browser session does not match the organization host", async () => {
  const browserIdentity = {
    apiVersion: 1 as const,
    accountId,
    organizations: [
      {
        id: organizationId,
        slug: "acme",
        displayName: "Acme",
        role: "owner" as const,
      },
    ],
  };
  const platformServices = services();
  platformServices.authenticate = async (token) =>
    token === "valid" ? { accountId, response: browserIdentity } : null;
  platformServices.authenticateBrowserSession = async (token) =>
    token === "browser-valid"
      ? { accountId, response: browserIdentity }
      : null;
  const app = createPlatformApp(platformServices, {
    browserAuth: {
      sessionCookieName: "radius_platform_session",
      authenticate: async (token) =>
        token === "browser-valid" ? browserIdentity : null,
      organizationForRequest: async (url) => url.hostname.split(".")[0]!,
      revoke: async () => true,
      clearSessionCookie: () => "radius_platform_session=; Max-Age=0",
    },
  });
  const denied = await app.request(
    "https://northwind.curvehq.sh/api/platform/v1/identity",
    { headers: { cookie: "radius_platform_session=browser-valid" } },
  );
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, "ORGANIZATION_HOST_MISMATCH");

  const allowed = await app.request(
    "https://acme.curvehq.sh/api/platform/v1/identity",
    { headers: { cookie: "radius_platform_session=browser-valid" } },
  );
  assert.equal(allowed.status, 200);
  assert.deepEqual((await allowed.json()).organizations, browserIdentity.organizations);

  const deniedBearer = await app.request(
    "https://northwind.curvehq.sh/api/platform/v1/identity",
    { headers: { authorization: "Bearer valid" } },
  );
  assert.equal(deniedBearer.status, 403);
});

test("validates and forwards organization membership changes", async () => {
  const membershipId = "66666666-6666-4666-8666-666666666666";
  const response = await createPlatformApp(services()).request(
    `/api/platform/v1/organizations/acme/memberships/${membershipId}`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
        "idempotency-key": "membership-change-1",
      },
      body: JSON.stringify({ apiVersion: 1, role: "developer" }),
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.membership.id, membershipId);
  assert.equal(body.membership.role, "developer");
});

test("validates and forwards one-time developer-token creation", async () => {
  const response = await createPlatformApp(services()).request(
    "/api/platform/v1/organizations/acme/developer-tokens",
    {
      method: "POST",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
        "idempotency-key": "token-create-test-1",
      },
      body: JSON.stringify({
        apiVersion: 1,
        label: "CI deploy",
        scopes: ["deployment.write"],
        expiresAt: null,
      }),
    },
  );
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.token.label, "CI deploy");
  assert.match(body.secret, /^radius_pat_/);
});

test("validates and forwards deployment preparation", async () => {
  const response = await createPlatformApp(services()).request(
    "/api/platform/v1/agents/agent_example1/deployments/prepare",
    {
      method: "POST",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
        "idempotency-key": "prepare-test-1",
      },
      body: JSON.stringify({
        apiVersion: 1,
        organization: "dev",
        agent: "agent_example1",
        environment: "staging",
        buildDigest: "a".repeat(64),
        bundleSha256: "b".repeat(64),
        manifest: {
          schemaVersion: 1,
          agent: "agent_example1",
          name: "Example",
          protocol: { kind: "acp-stdio", version: 1 },
          runtime: {
            kind: "typescript",
            entrypoint: "radius/agent.ts",
            node: "22",
          },
          capabilities: [],
          networkAllowlist: [],
          resources: { cpu: 2, memoryMb: 4096, diskMb: 5120 },
          minimumDesktopVersion: "0.0.1",
        },
      }),
    },
  );
  assert.equal(response.status, 201);
  assert.equal((await response.json()).uploadId, uploadId);
});

test("rejects prepare requests without idempotency", async () => {
  const response = await createPlatformApp(services()).request(
    "/api/platform/v1/agents/agent_example1/deployments/prepare",
    {
      method: "POST",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      body: "{}",
    },
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "IDEMPOTENCY_KEY_REQUIRED");
});

test("rejects JSON requests larger than one MiB", async () => {
  const response = await createPlatformApp(services()).request(
    "/api/platform/v1/agents/agent_example1/deployments/prepare",
    {
      method: "POST",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
        "idempotency-key": "prepare-test-large",
      },
      body: `{"padding":"${"x".repeat(1_048_576)}"}`,
    },
  );
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "PAYLOAD_TOO_LARGE");
});

test("validates and forwards explicit deployment promotion", async () => {
  const response = await createPlatformApp(services()).request(
    "/api/platform/v1/agents/agent_example1/environments/production/deployments/promote",
    {
      method: "POST",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
        "idempotency-key": "promote-test-1",
      },
      body: JSON.stringify({
        apiVersion: 1,
        agentDeploymentId,
        expectedDeploymentRevision: 1,
      }),
    },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).environmentRevision.revision, 2);
});

test("bounds deployment inventory pagination", async () => {
  const response = await createPlatformApp(services()).request(
    "/api/platform/v1/agents/agent_example1/deployments?limit=101",
    { headers: { authorization: "Bearer valid" } },
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_PAGE_LIMIT");
});

test("registers a physical device and client installation observation", async () => {
  const clientInstanceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const response = await createPlatformApp(services()).request(
    `/api/platform/v1/client-installations/${clientInstanceId}`,
    {
      method: "PUT",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
        "idempotency-key": "client-register-test-1",
      },
      body: JSON.stringify({
        apiVersion: 1,
        organization: "dev",
        clientInstanceId,
        physicalDevice: {
          fingerprint: `sha256:${"e".repeat(64)}`,
          displayName: "Test Mac",
          assetTag: null,
          platform: "darwin",
          architecture: "arm64",
        },
        observation: {
          clientEventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          schemaVersion: 1,
          desktopVersion: "0.0.1",
          runtimeVersion: "0.0.1",
          runtimeProtocolVersion: 1,
          state: "ready",
          errorCode: null,
          observedAt: "2026-08-27T12:00:00.000Z",
        },
      }),
    },
  );
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).clientInstallationId,
    clientInstallationId,
  );
});

test("reports an incompatible agent installation with a stable error code", async () => {
  const response = await createPlatformApp(services()).request(
    `/api/platform/v1/client-installations/${clientInstallationId}/agents/agent_example1/observations`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
        "idempotency-key": "agent-observation-test-1",
      },
      body: JSON.stringify({
        apiVersion: 1,
        agentDeploymentId,
        clientEventId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        schemaVersion: 1,
        state: "blocked_incompatible",
        errorCode: "DESKTOP_VERSION_TOO_OLD",
        observedAt: "2026-08-27T12:01:00.000Z",
      }),
    },
  );
  assert.equal(response.status, 200);
  assert.match((await response.json()).agentInstallationId, /^[0-9a-f-]+$/);
});

test("managed deployments resolve the organization from forwarded proxy headers", async () => {
  const browserIdentity = {
    apiVersion: 1 as const,
    accountId,
    organizations: [
      {
        id: organizationId,
        slug: "acme",
        displayName: "Acme",
        role: "owner" as const,
      },
    ],
  };
  const platformServices = services();
  const browserAuth = {
    sessionCookieName: "radius_platform_session",
    authenticate: async (token: string) =>
      token === "browser-valid" ? browserIdentity : null,
    organizationForRequest: async (url: URL) => {
      if (url.protocol !== "https:") throw new Error("HTTPS required");
      return url.hostname.split(".")[0]!;
    },
    revoke: async () => true,
    clearSessionCookie: () => "radius_platform_session=; Max-Age=0",
  };
  const headers = {
    cookie: "radius_platform_session=browser-valid",
    "x-forwarded-host": "acme.curvehq.sh",
    "x-forwarded-proto": "https",
  };

  const managed = createPlatformApp(platformServices, {
    browserAuth,
    deploymentMode: "managed",
  });
  const allowed = await managed.request(
    "http://platform-api:3100/api/platform/v1/auth/session",
    { headers },
  );
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).organizations[0].slug, "acme");

  const selfHosted = createPlatformApp(platformServices, {
    browserAuth,
    deploymentMode: "self_hosted",
  });
  const ignored = await selfHosted.request(
    "http://platform-api:3100/api/platform/v1/auth/session",
    { headers },
  );
  assert.equal(ignored.status, 500);
});
