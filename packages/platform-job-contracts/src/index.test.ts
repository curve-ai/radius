import assert from "node:assert/strict";
import test from "node:test";

import {
  PlatformJobEnvelopeSchema,
  RADIUS_PLATFORM_JOB_NAMES,
  VerifyAgentDeploymentPayloadSchema,
} from "./index.js";

test("accepts a credential-free deployment verification job", () => {
  const data = VerifyAgentDeploymentPayloadSchema.parse({
    version: 1,
    idempotencyKey: "deployment:verify:12345678",
    organizationId: "22222222-2222-4222-8222-222222222222",
    agent: "agent_example1",
    agentDeploymentId: "33333333-3333-4333-8333-333333333333",
    imageReference: "registry.example.com/team/agent:deployment-1",
    expectedImageDigest:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  assert.equal(data.agent, "agent_example1");
  assert.equal("password" in data, false);
  assert.equal(
    PlatformJobEnvelopeSchema.parse({
      name: RADIUS_PLATFORM_JOB_NAMES.verifyAgentDeployment,
      data,
    }).name,
    RADIUS_PLATFORM_JOB_NAMES.verifyAgentDeployment,
  );
});

test("rejects unversioned and malformed deployment verification jobs", () => {
  assert.throws(() =>
    VerifyAgentDeploymentPayloadSchema.parse({
      version: 2,
      idempotencyKey: "short",
      organizationId: "not-a-uuid",
      agent: "agent",
      agentDeploymentId: "not-a-uuid",
      imageReference: "registry.example.com/team/agent:deployment-1",
      expectedImageDigest: "latest",
    }),
  );
});
