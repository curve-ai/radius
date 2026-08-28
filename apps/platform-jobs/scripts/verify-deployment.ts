import { randomUUID } from "node:crypto";

import {
  RADIUS_PLATFORM_JOB_NAMES,
  RADIUS_PLATFORM_JOBS_QUEUE,
  VerifyAgentDeploymentPayloadSchema,
  VerifyAgentDeploymentResultSchema,
} from "@curve-ai/platform-job-contracts";
import { Queue, QueueEvents } from "bullmq";
import { Redis } from "ioredis";

const redisUrl = process.env.JOBS_REDIS_URL?.trim() || "redis://127.0.0.1:6381";
const imageReference = requiredEnvironment("RADIUS_VERIFY_IMAGE_REFERENCE");
const expectedImageDigest = requiredEnvironment("RADIUS_VERIFY_IMAGE_DIGEST");
const agentDeploymentId = randomUUID();
const payload = VerifyAgentDeploymentPayloadSchema.parse({
  version: 1,
  idempotencyKey: `deployment:verify:${agentDeploymentId}`,
  organizationId: "22222222-2222-4222-8222-222222222222",
  agent: "agent_example1",
  agentDeploymentId,
  imageReference,
  expectedImageDigest,
});

const producerConnection = new Redis(redisUrl, {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
});
const eventsConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue(RADIUS_PLATFORM_JOBS_QUEUE, {
  connection: producerConnection,
});
const events = new QueueEvents(RADIUS_PLATFORM_JOBS_QUEUE, {
  connection: eventsConnection,
});

try {
  await events.waitUntilReady();
  const job = await queue.add(
    RADIUS_PLATFORM_JOB_NAMES.verifyAgentDeployment,
    payload,
    {
      jobId: `agentDeployment-verify-${agentDeploymentId}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 500 },
      removeOnComplete: true,
      removeOnFail: { age: 24 * 60 * 60, count: 100 },
    },
  );
  const result = VerifyAgentDeploymentResultSchema.parse(
    await job.waitUntilFinished(events, 15_000),
  );
  console.info(
    `Deployment ${result.agentDeploymentId} verified ${result.imageDigest} on ${result.workerId}`,
  );
} finally {
  await events.close();
  await queue.close();
  producerConnection.disconnect();
  eventsConnection.disconnect();
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
