import assert from "node:assert/strict";
import test from "node:test";

import { createDevelopmentPlatformServices } from "./dev-services.js";

test("prepares idempotently and finalizes a registry-backed dev deployment", async () => {
  const services = createDevelopmentPlatformServices({
    accessToken: "dev-token",
    now: () => new Date("2026-08-25T20:00:00.000Z"),
    fetch: async (_input, init) =>
      new Response(null, {
        status: init?.method === "HEAD" ? 200 : 500,
        headers: { "docker-content-digest": `sha256:${"d".repeat(64)}` },
      }),
  });
  const identity = await services.authenticate("dev-token");
  assert.ok(identity);
  const request = {
    apiVersion: 1 as const,
    organization: "dev",
    agent: "agent_example1",
    environment: "staging",
    buildDigest: "a".repeat(64),
    bundleSha256: "b".repeat(64),
    manifest: {
      schemaVersion: 1 as const,
      agent: "agent_example1",
      name: "Example",
      protocol: { kind: "acp-stdio" as const, version: 1 as const },
      runtime: {
        kind: "typescript" as const,
        entrypoint: "radius/agent.ts",
        node: "22",
      },
      capabilities: [],
      networkAllowlist: [],
      resources: { cpu: 2, memoryMb: 4096, diskMb: 5120 },
      minimumDesktopVersion: "0.0.1",
    },
  };
  const first = await services.prepareAgentDeployment({
    identity,
    request,
    idempotencyKey: "prepare-1",
  });
  const duplicate = await services.prepareAgentDeployment({
    identity,
    request,
    idempotencyKey: "prepare-1",
  });
  assert.equal(duplicate.uploadId, first.uploadId);

  const finalized = await services.finalizeAgentDeployment({
    identity,
    agent: "agent_example1",
    idempotencyKey: `finalize-${first.uploadId}`,
    request: {
      apiVersion: 1,
      organization: "dev",
      uploadId: first.uploadId,
      imageDigest: `sha256:${"d".repeat(64)}`,
      sourceManifestDigest: `sha256:${"c".repeat(64)}`,
      bundleSha256: "b".repeat(64),
      sbomDigest: null,
      provenanceDigest: null,
      promote: true,
      expectedDeploymentRevision: null,
    },
  });
  assert.equal(finalized.agentDeployment.state, "verified");
  assert.equal(finalized.environmentRevision?.revision, 1);

  const duplicateFinalization = await services.finalizeAgentDeployment({
    identity,
    agent: "agent_example1",
    idempotencyKey: `finalize-${first.uploadId}`,
    request: {
      apiVersion: 1,
      organization: "dev",
      uploadId: first.uploadId,
      imageDigest: `sha256:${"d".repeat(64)}`,
      sourceManifestDigest: `sha256:${"c".repeat(64)}`,
      bundleSha256: "b".repeat(64),
      sbomDigest: null,
      provenanceDigest: null,
      promote: true,
      expectedDeploymentRevision: null,
    },
  });
  assert.equal(
    duplicateFinalization.agentDeployment.id,
    finalized.agentDeployment.id,
  );

  const secondPrepared = await services.prepareAgentDeployment({
    identity,
    request: {
      ...request,
      buildDigest: "e".repeat(64),
      bundleSha256: "f".repeat(64),
    },
    idempotencyKey: "prepare-2",
  });
  const secondFinalized = await services.finalizeAgentDeployment({
    identity,
    agent: "agent_example1",
    idempotencyKey: `finalize-${secondPrepared.uploadId}`,
    request: {
      apiVersion: 1,
      organization: "dev",
      uploadId: secondPrepared.uploadId,
      imageDigest: `sha256:${"d".repeat(64)}`,
      sourceManifestDigest: `sha256:${"e".repeat(64)}`,
      bundleSha256: "f".repeat(64),
      sbomDigest: null,
      provenanceDigest: null,
      promote: false,
      expectedDeploymentRevision: null,
    },
  });
  const promoted = await services.promoteAgentDeployment({
    identity,
    agent: "agent_example1",
    environment: "staging",
    idempotencyKey: "promote-second-agentDeployment",
    request: {
      apiVersion: 1,
      agentDeploymentId: secondFinalized.agentDeployment.id,
      expectedDeploymentRevision: 1,
    },
  });
  assert.equal(promoted.environmentRevision.revision, 2);
  assert.equal(
    promoted.environmentRevision.previousAgentDeploymentId,
    finalized.agentDeployment.id,
  );

  const rolledBack = await services.rollbackAgentDeployment({
    identity,
    agent: "agent_example1",
    environment: "staging",
    idempotencyKey: "rollback-first-agentDeployment",
    request: {
      apiVersion: 1,
      agentDeploymentId: finalized.agentDeployment.id,
      expectedDeploymentRevision: 2,
    },
  });
  assert.equal(rolledBack.environmentRevision.revision, 3);
  assert.equal(
    rolledBack.environmentRevision.previousAgentDeploymentId,
    secondFinalized.agentDeployment.id,
  );

  const agents = await services.listAgents({
    identity,
    organization: "dev",
  });
  const staging = agents.agents[0]?.environments.find(
    (environment) => environment.name === "staging",
  );
  assert.equal(staging?.deployment?.revision, 3);
  assert.equal(
    staging?.deployment?.agentDeploymentVersion,
    finalized.agentDeployment.version,
  );

  const firstReleasePage = await services.listAgentDeployments({
    identity,
    agent: "agent_example1",
    limit: 1,
    cursor: null,
  });
  assert.equal(
    firstReleasePage.agentDeployments[0]?.id,
    secondFinalized.agentDeployment.id,
  );
  assert.ok(firstReleasePage.nextCursor);
  const secondReleasePage = await services.listAgentDeployments({
    identity,
    agent: "agent_example1",
    limit: 1,
    cursor: firstReleasePage.nextCursor,
  });
  assert.equal(
    secondReleasePage.agentDeployments[0]?.id,
    finalized.agentDeployment.id,
  );
  assert.equal(secondReleasePage.nextCursor, null);

  const history = await services.listAgentEnvironmentHistory({
    identity,
    agent: "agent_example1",
    environment: "staging",
    limit: 10,
    cursor: null,
  });
  assert.equal(history.currentRevision, 3);
  assert.deepEqual(
    history.revisions.map((revision) => revision.action),
    ["rollback", "promote", "deploy"],
  );

  await services.prepareAgentDeployment({
    identity,
    request: {
      ...request,
      agent: "agent_python1",
      manifest: {
        ...request.manifest,
        agent: "agent_python1",
        name: "Python Example Agent",
        runtime: {
          kind: "python",
          module: "radius_python_agent.agent",
          python: "3.12",
          lockfile: "uv.lock",
        },
      },
    },
    idempotencyKey: "prepare-python-agent",
  });
  const projectsWithPython = await services.listAgents({
    identity,
    organization: "dev",
  });
  assert.equal(
    projectsWithPython.agents.find((agent) => agent.agent === "agent_python1")
      ?.name,
    "Python Example Agent",
  );
});
