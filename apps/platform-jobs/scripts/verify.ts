import {
  PlatformHealthcheckResultSchema,
  RADIUS_PLATFORM_JOB_NAMES,
  RADIUS_PLATFORM_JOBS_QUEUE,
} from "@curve-ai/platform-job-contracts";
import { Queue, QueueEvents } from "bullmq";
import { Redis } from "ioredis";

const redisUrl = process.env.JOBS_REDIS_URL?.trim() || "redis://127.0.0.1:6381";
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
    RADIUS_PLATFORM_JOB_NAMES.healthcheck,
    { version: 1, message: "Radius Platform worker is ready" },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 500 },
      removeOnComplete: true,
      removeOnFail: { age: 24 * 60 * 60, count: 100 },
    },
  );
  const result = PlatformHealthcheckResultSchema.parse(
    await job.waitUntilFinished(events, 15_000),
  );
  console.info(
    `Platform job healthcheck completed on ${result.workerId}: ${result.message}`,
  );
} finally {
  await events.close();
  await queue.close();
  producerConnection.disconnect();
  eventsConnection.disconnect();
}
