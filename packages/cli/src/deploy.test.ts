import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAgentManifest } from "@curve-ai/build";
import type {
  FinalizeAgentDeploymentRequest,
  PrepareAgentDeploymentRequest,
} from "@curve-ai/platform-client";

import { deployAgent, type DeploymentPlatformClient } from "./deploy.js";

test("prepares, uploads, and finalizes one exact remote deployment", async () => {
  const root = await mkdtemp(join(tmpdir(), "radius-remote-deploy-"));
  await writeFile(
    join(root, "radius.config.json"),
    JSON.stringify({
      schemaVersion: 1,
      agent: "agent_example1",
      name: "Remote agent",
      runtime: {
        kind: "typescript",
        entrypoint: "radius/agent.ts",
        node: "22",
      },
    }),
  );
  await mkdir(join(root, "radius"));
  await writeFile(join(root, "radius", "agent.ts"), "export {};\n");

  const preparedRequests: PrepareAgentDeploymentRequest[] = [];
  const finalizedRequests: FinalizeAgentDeploymentRequest[] = [];
  const client: DeploymentPlatformClient = {
    info: async () => ({
      apiVersion: 1,
      platformVersion: "0.0.1",
      deploymentModes: ["self_hosted"],
      supportedAgentConfigVersions: [1],
      supportedAgentManifestVersions: [1],
      registryUpload: true,
    }),
    prepareAgentDeployment: async (request) => {
      preparedRequests.push(request);
      return {
        apiVersion: 1,
        uploadId: "11111111-1111-4111-8111-111111111111",
        imageReference: "registry.example/acme/agent:upload",
        credentials: {
          registry: "registry.example",
          username: "upload",
          password: "secret",
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
      };
    },
    finalizeAgentDeployment: async (_agent, request) => {
      finalizedRequests.push(request);
      return {
        apiVersion: 1,
        agentDeployment: {
          id: "22222222-2222-4222-8222-222222222222",
          version: "20260825.1",
          imageDigest: request.imageDigest,
          state: "verified",
        },
        environmentRevision: {
          environment: "staging",
          revision: 3,
          agentDeploymentId: "22222222-2222-4222-8222-222222222222",
        },
      };
    },
  };
  const output: string[] = [];
  await deployAgent({
    root,
    dryRun: false,
    environment: "staging",
    organization: "dev",
    platformClient: client,
    buildOci: async ({ config }) => ({
      buildDigest: "a".repeat(64),
      imageReference: "radius.local/dev/remote-agent:test",
      imageDigest: `sha256:${"b".repeat(64)}`,
      layoutPath: join(root, "layout"),
      contextPath: join(root, "context"),
      manifest: createAgentManifest(config),
      bundleSha256: "c".repeat(64),
    }),
    pushOci: async () => `sha256:${"d".repeat(64)}`,
    io: { out: (message) => output.push(message), error: () => undefined },
  });

  const preparedRequest = preparedRequests[0];
  assert.ok(preparedRequest);
  assert.equal(preparedRequest.organization, "dev");
  assert.equal(preparedRequest.environment, "staging");
  const finalizedRequest = finalizedRequests[0];
  assert.ok(finalizedRequest);
  assert.equal(finalizedRequest.organization, "dev");
  assert.equal(finalizedRequest.imageDigest, `sha256:${"d".repeat(64)}`);
  assert.equal(
    finalizedRequest.sourceManifestDigest,
    `sha256:${"b".repeat(64)}`,
  );
  assert.ok(output.includes("Environment: staging revision 3"));
});
