import assert from "node:assert/strict";
import test from "node:test";

import {
  RADIUS_PLATFORM_JOB_NAMES,
  type PlatformJobEnvelope,
} from "@curve-ai/platform-job-contracts";

import { createPlatformJobProcessor } from "./index.js";

const expectedDigest =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

test("processes a healthcheck deterministically", async () => {
  const processor = createPlatformJobProcessor({
    registryVerifier: {
      verifyManifest: async () => {
        throw new Error("not used");
      },
    },
    now: () => new Date("2026-08-25T20:00:00.000Z"),
    workerId: "worker-test",
  });

  assert.deepEqual(
    await processor({
      name: RADIUS_PLATFORM_JOB_NAMES.healthcheck,
      data: { version: 1, message: "ready" },
    }),
    {
      ok: true,
      version: 1,
      message: "ready",
      completedAt: "2026-08-25T20:00:00.000Z",
      workerId: "worker-test",
    },
  );
});

test("verifies a deployment through the injected registry provider", async () => {
  let receivedReference = "";
  const processor = createPlatformJobProcessor({
    registryVerifier: {
      verifyManifest: async (request) => {
        receivedReference = request.imageReference;
        return {
          digest: request.expectedDigest,
          mediaType: "application/vnd.oci.image.manifest.v1+json",
          contentLength: 712,
        };
      },
    },
    now: () => new Date("2026-08-25T20:01:00.000Z"),
    workerId: "worker-test",
  });
  const job: PlatformJobEnvelope = {
    name: RADIUS_PLATFORM_JOB_NAMES.verifyAgentDeployment,
    data: {
      version: 1,
      idempotencyKey: "deployment:verify:12345678",
      organizationId: "22222222-2222-4222-8222-222222222222",
      agent: "agent_example1",
      agentDeploymentId: "33333333-3333-4333-8333-333333333333",
      imageReference: "registry.example.com/radius/agent:deployment-1",
      expectedImageDigest: expectedDigest,
    },
  };

  const result = await processor(job);

  assert.equal(receivedReference, job.data.imageReference);
  assert.deepEqual(result, {
    ok: true,
    version: 1,
    agentDeploymentId: job.data.agentDeploymentId,
    imageDigest: expectedDigest,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    contentLength: 712,
    verifiedAt: "2026-08-25T20:01:00.000Z",
    workerId: "worker-test",
  });
});
