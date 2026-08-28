import assert from "node:assert/strict";
import test from "node:test";

import { RadiusPlatformClient, validatePlatformBaseUrl } from "./index.js";

test("allows HTTPS and explicit loopback HTTP only", () => {
  assert.equal(
    validatePlatformBaseUrl("https://acme.curvehq.sh/x").href,
    "https://acme.curvehq.sh/",
  );
  assert.equal(
    validatePlatformBaseUrl("http://127.0.0.1:3100").href,
    "http://127.0.0.1:3100/",
  );
  assert.throws(() => validatePlatformBaseUrl("http://platform.example.com"));
});

test("allows explicitly trusted internal HTTP without changing the default", () => {
  assert.equal(
    validatePlatformBaseUrl("http://platform-api:3100", {
      allowInsecureHttp: true,
    }).href,
    "http://platform-api:3100/",
  );
  assert.throws(() => validatePlatformBaseUrl("http://platform-api:3100"));
});

test("attaches bearer and idempotency headers to deployment preparation", async () => {
  const observed: Request[] = [];
  const client = new RadiusPlatformClient({
    baseUrl: "https://acme.curvehq.sh",
    accessToken: "secret-token",
    fetch: async (input, init) => {
      observed.push(new Request(input, init));
      return Response.json({
        apiVersion: 1,
        uploadId: "11111111-1111-4111-8111-111111111111",
        imageReference: "registry.example/acme/agent:upload",
        credentials: {
          registry: "registry.example",
          username: "upload",
          password: "short-lived",
          expiresAt: "2026-08-25T20:00:00.000Z",
        },
      });
    },
  });

  await client.prepareAgentDeployment(
    {
      apiVersion: 1,
      organization: "acme",
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
    },
    "deploy-attempt-1",
  );

  const request = observed[0];
  assert.ok(request);
  assert.equal(request.headers.get("authorization"), "Bearer secret-token");
  assert.equal(request.headers.get("idempotency-key"), "deploy-attempt-1");
});

test("rejects authenticated calls without a token", async () => {
  const client = new RadiusPlatformClient({
    baseUrl: "https://acme.curvehq.sh",
    fetch: async () => Response.json({}),
  });
  await assert.rejects(client.identity(), /authentication is required/);
});

test("stops reading a chunked response after the JSON limit", async () => {
  let cancelled = false;
  const client = new RadiusPlatformClient({
    baseUrl: "https://platform.example.com",
    fetch: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array(600_000));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  await assert.rejects(client.info(), /exceeded 1 MiB/);
  assert.equal(cancelled, true);
});

test("forwards an HttpOnly browser-session cookie without requiring bearer auth", async () => {
  let request: Request | undefined;
  const client = new RadiusPlatformClient({
    baseUrl: "https://platform.example.com",
    cookie: "radius_platform_session=opaque",
    fetch: async (input, init) => {
      request = new Request(input, init);
      return Response.json({
        apiVersion: 1,
        accountId: "11111111-1111-4111-8111-111111111111",
        organizations: [],
      });
    },
  });
  await client.browserSessionIdentity();
  assert.equal(
    request?.headers.get("cookie"),
    "radius_platform_session=opaque",
  );
  assert.equal(request?.headers.get("authorization"), null);
});

test("updates an organization membership with idempotency", async () => {
  let request: Request | undefined;
  const client = new RadiusPlatformClient({
    baseUrl: "https://platform.example.com",
    accessToken: "owner-token",
    fetch: async (input, init) => {
      request = new Request(input, init);
      return Response.json({
        apiVersion: 1,
        organization: "acme",
        membership: {
          id: "11111111-1111-4111-8111-111111111111",
          accountId: "22222222-2222-4222-8222-222222222222",
          displayName: "Build Engineer",
          email: "build@example.com",
          role: "developer",
          lifecycleState: "active",
          joinedAt: "2026-08-26T12:00:00.000Z",
          updatedAt: "2026-08-26T13:00:00.000Z",
          developerTokenCount: 0,
          current: false,
        },
      });
    },
  });
  await client.updateOrganizationMembership(
    "acme",
    "11111111-1111-4111-8111-111111111111",
    { apiVersion: 1, role: "developer" },
    "membership-update-1",
  );
  assert.equal(
    new URL(request!.url).pathname,
    "/api/platform/v1/organizations/acme/memberships/11111111-1111-4111-8111-111111111111",
  );
  assert.equal(request?.headers.get("idempotency-key"), "membership-update-1");
  assert.deepEqual(await request?.json(), { apiVersion: 1, role: "developer" });
});

test("sends an explicit revision-checked promotion", async () => {
  let requestedPath = "";
  const client = new RadiusPlatformClient({
    baseUrl: "https://platform.example.com",
    accessToken: "secret",
    fetch: async (input, init) => {
      requestedPath = new URL(String(input)).pathname;
      assert.equal(
        new Headers(init?.headers).get("idempotency-key"),
        "promote-12345678",
      );
      return Response.json({
        apiVersion: 1,
        environmentRevision: {
          environment: "production",
          revision: 2,
          agentDeploymentId: "33333333-3333-4333-8333-333333333333",
          previousAgentDeploymentId: "44444444-4444-4444-8444-444444444444",
        },
      });
    },
  });

  const result = await client.promoteAgentDeployment(
    "agent_example1",
    "production",
    {
      apiVersion: 1,
      agentDeploymentId: "33333333-3333-4333-8333-333333333333",
      expectedDeploymentRevision: 1,
    },
    "promote-12345678",
  );

  assert.equal(
    requestedPath,
    "/api/platform/v1/agents/agent_example1/environments/production/deployments/promote",
  );
  assert.equal(result.environmentRevision.revision, 2);
});

test("requests bounded paginated deployment history", async () => {
  let requestedUrl = "";
  const client = new RadiusPlatformClient({
    baseUrl: "https://platform.example.com",
    accessToken: "secret",
    fetch: async (input) => {
      requestedUrl = String(input);
      return Response.json({
        apiVersion: 1,
        agent: "agent_example1",
        environment: "staging",
        currentRevision: 0,
        revisions: [],
        nextCursor: null,
      });
    },
  });

  await client.listAgentEnvironmentHistory("agent_example1", "staging", {
    limit: 25,
    cursor: "opaque-cursor",
  });

  assert.equal(
    requestedUrl,
    "https://platform.example.com/api/platform/v1/agents/agent_example1/environments/staging/deployments?limit=25&cursor=opaque-cursor",
  );
});

test("creates a developer token with idempotency and validates one-time secret", async () => {
  let request: Request | undefined;
  const client = new RadiusPlatformClient({
    baseUrl: "https://platform.example.com",
    accessToken: "owner-token",
    fetch: async (input, init) => {
      request = new Request(input, init);
      return Response.json({
        apiVersion: 1,
        token: {
          id: "11111111-1111-4111-8111-111111111111",
          label: "CI deploy",
          prefix: "radius_pat_abcde",
          scopes: ["deployment.write"],
          createdAt: "2026-08-26T12:00:00.000Z",
          lastUsedAt: null,
          expiresAt: null,
          revokedAt: null,
          current: false,
        },
        secret: `radius_pat_${"a".repeat(43)}`,
      });
    },
  });
  const result = await client.createDeveloperToken(
    "acme",
    {
      apiVersion: 1,
      label: "CI deploy",
      scopes: ["deployment.write"],
      expiresAt: null,
    },
    "token-create-12345678",
  );
  assert.equal(result.token.label, "CI deploy");
  assert.equal(
    request?.url,
    "https://platform.example.com/api/platform/v1/organizations/acme/developer-tokens",
  );
  assert.equal(
    request?.headers.get("idempotency-key"),
    "token-create-12345678",
  );
});
