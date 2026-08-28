import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateDeveloperTokenRequestSchema,
  AgentEnvironmentChangeResponseSchema,
  ListAgentEnvironmentHistoryResponseSchema,
  ListAgentDeploymentsResponseSchema,
  ListOrganizationMembershipsResponseSchema,
  FinalizeAgentDeploymentRequestSchema,
  PromoteAgentDeploymentRequestSchema,
  PrepareAgentDeploymentRequestSchema,
  RegisterClientInstallationRequestSchema,
  ReportAgentInstallationRequestSchema,
  RollbackAgentDeploymentRequestSchema,
  UpdateOrganizationMembershipRequestSchema,
} from "./index.js";

test("models organization membership roles and lifecycle changes", () => {
  const response = ListOrganizationMembershipsResponseSchema.parse({
    apiVersion: 1,
    organization: "dev",
    memberships: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        accountId: "22222222-2222-4222-8222-222222222222",
        displayName: "Deployment Owner",
        email: "owner@example.com",
        role: "owner",
        lifecycleState: "active",
        joinedAt: "2026-08-26T12:00:00.000Z",
        updatedAt: "2026-08-26T12:00:00.000Z",
        developerTokenCount: 1,
        current: true,
      },
    ],
  });
  assert.equal(response.memberships[0]?.current, true);
  assert.deepEqual(
    UpdateOrganizationMembershipRequestSchema.parse({
      apiVersion: 1,
      role: "developer",
    }),
    { apiVersion: 1, role: "developer" },
  );
  assert.throws(() =>
    UpdateOrganizationMembershipRequestSchema.parse({ apiVersion: 1 }),
  );
});

test("keeps installation error states and error codes consistent", () => {
  const clientBase = {
    apiVersion: 1,
    organization: "dev",
    clientInstanceId: "11111111-1111-4111-8111-111111111111",
    physicalDevice: {
      fingerprint: `sha256:${"a".repeat(64)}`,
      displayName: "Developer Mac",
      assetTag: null,
      platform: "darwin",
      architecture: "arm64",
    },
    observation: {
      clientEventId: "22222222-2222-4222-8222-222222222222",
      schemaVersion: 1,
      desktopVersion: "0.0.1",
      runtimeVersion: "0.0.1",
      runtimeProtocolVersion: 1,
      state: "ready",
      errorCode: null,
      observedAt: "2026-08-27T12:00:00.000Z",
    },
  } as const;
  assert.equal(
    RegisterClientInstallationRequestSchema.safeParse(clientBase).success,
    true,
  );
  assert.equal(
    RegisterClientInstallationRequestSchema.safeParse({
      ...clientBase,
      observation: {
        ...clientBase.observation,
        state: "error",
        errorCode: null,
      },
    }).success,
    false,
  );
  assert.equal(
    ReportAgentInstallationRequestSchema.safeParse({
      apiVersion: 1,
      agentDeploymentId: "33333333-3333-4333-8333-333333333333",
      clientEventId: "44444444-4444-4444-8444-444444444444",
      schemaVersion: 1,
      state: "blocked_incompatible",
      errorCode: "DESKTOP_VERSION_TOO_OLD",
      observedAt: "2026-08-27T12:01:00.000Z",
    }).success,
    true,
  );
});

test("validates bounded atomic developer-token scopes", () => {
  const parsed = CreateDeveloperTokenRequestSchema.parse({
    apiVersion: 1,
    label: "CI deploy",
    scopes: ["agent.read", "deployment.write"],
    expiresAt: "2026-09-26T00:00:00.000Z",
  });
  assert.deepEqual(parsed.scopes, ["agent.read", "deployment.write"]);
  assert.throws(() =>
    CreateDeveloperTokenRequestSchema.parse({
      apiVersion: 1,
      label: "Invalid",
      scopes: ["agentDeployment.*"],
      expiresAt: null,
    }),
  );
});

const manifest = {
  schemaVersion: 1,
  agent: "agent_example1",
  name: "Example",
  protocol: { kind: "acp-stdio", version: 1 },
  runtime: { kind: "typescript", entrypoint: "radius/agent.ts", node: "22" },
  capabilities: [],
  networkAllowlist: [],
  resources: { cpu: 2, memoryMb: 4096, diskMb: 5120 },
  minimumDesktopVersion: "0.0.1",
};

test("accepts deployment preparation for the same agent manifest", () => {
  const request = PrepareAgentDeploymentRequestSchema.parse({
    apiVersion: 1,
    organization: "dev",
    agent: "agent_example1",
    environment: "staging",
    buildDigest: "a".repeat(64),
    bundleSha256: "b".repeat(64),
    manifest,
  });
  assert.equal(request.agent, request.manifest.agent);
});

test("rejects an invalid mutable image reference during finalization", () => {
  const result = FinalizeAgentDeploymentRequestSchema.safeParse({
    apiVersion: 1,
    organization: "dev",
    uploadId: "11111111-1111-4111-8111-111111111111",
    imageDigest: "latest",
    sourceManifestDigest: `sha256:${"a".repeat(64)}`,
    bundleSha256: "b".repeat(64),
    sbomDigest: null,
    provenanceDigest: null,
    promote: true,
    expectedDeploymentRevision: null,
  });
  assert.equal(result.success, false);
});

test("models promotion and rollback as revision-checked deployment selection", () => {
  const agentDeploymentId = "33333333-3333-4333-8333-333333333333";
  assert.deepEqual(
    PromoteAgentDeploymentRequestSchema.parse({
      apiVersion: 1,
      agentDeploymentId,
      expectedDeploymentRevision: null,
    }),
    { apiVersion: 1, agentDeploymentId, expectedDeploymentRevision: null },
  );
  assert.equal(
    RollbackAgentDeploymentRequestSchema.parse({
      apiVersion: 1,
      agentDeploymentId,
      expectedDeploymentRevision: 2,
    }).expectedDeploymentRevision,
    2,
  );
  assert.equal(
    AgentEnvironmentChangeResponseSchema.parse({
      apiVersion: 1,
      environmentRevision: {
        environment: "production",
        revision: 3,
        agentDeploymentId,
        previousAgentDeploymentId: "44444444-4444-4444-8444-444444444444",
      },
    }).environmentRevision.revision,
    3,
  );
});

test("models paginated deployment inventory and append-only environment history", () => {
  const agentDeploymentId = "33333333-3333-4333-8333-333333333333";
  const digest = `sha256:${"a".repeat(64)}`;
  assert.equal(
    ListAgentDeploymentsResponseSchema.parse({
      apiVersion: 1,
      agent: "agent_example1",
      agentDeployments: [
        {
          id: agentDeploymentId,
          version: "20260825.1",
          imageDigest: digest,
          sourceManifestDigest: digest,
          sbomDigest: null,
          provenanceDigest: null,
          minimumDesktopVersion: "0.0.1",
          runtimeProtocolVersion: 1,
          state: "verified",
          createdAt: "2026-08-25T20:00:00.000Z",
        },
      ],
      nextCursor: null,
    }).agentDeployments[0]?.id,
    agentDeploymentId,
  );
  assert.equal(
    ListAgentEnvironmentHistoryResponseSchema.parse({
      apiVersion: 1,
      agent: "agent_example1",
      environment: "staging",
      currentRevision: 1,
      revisions: [
        {
          revision: 1,
          action: "deploy",
          agentDeploymentId,
          agentDeploymentVersion: "20260825.1",
          imageDigest: digest,
          previousAgentDeploymentId: null,
          createdAt: "2026-08-25T20:00:00.000Z",
        },
      ],
      nextCursor: null,
    }).revisions[0]?.action,
    "deploy",
  );
});
