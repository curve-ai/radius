import { hostname } from "node:os";

import {
  PlatformJobEnvelopeSchema,
  RADIUS_PLATFORM_JOBS_QUEUE,
} from "@curve-ai/platform-job-contracts";
import { createPlatformDatabase } from "@curve-ai/platform-database";
import { createDistributionRegistryVerifier } from "@curve-ai/platform-providers";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";

import { createPlatformJobProcessor } from "./index.js";
import { dispatchPlatformOutbox } from "./outbox.js";

const redisUrl = requiredEnvironment("JOBS_REDIS_URL");
const databaseUrl = requiredEnvironment("DATABASE_URL");
const allowedRegistries = requiredEnvironment("RADIUS_PLATFORM_REGISTRIES")
  .split(",")
  .map((registry) => registry.trim())
  .filter(Boolean);
const insecureRegistries = (
  process.env.RADIUS_PLATFORM_INSECURE_REGISTRIES ?? ""
)
  .split(",")
  .map((registry) => registry.trim())
  .filter(Boolean);
const registryEndpoints = parseRegistryEndpoints(
  process.env.RADIUS_PLATFORM_REGISTRY_ENDPOINTS,
);
const registryUsername = process.env.RADIUS_PLATFORM_REGISTRY_USERNAME?.trim();
const registryPassword = process.env.RADIUS_PLATFORM_REGISTRY_PASSWORD;
if (
  (registryUsername && !registryPassword) ||
  (!registryUsername && registryPassword)
) {
  throw new Error("Registry username and password must be configured together");
}

const registryVerifier = createDistributionRegistryVerifier({
  allowedRegistries,
  insecureRegistries,
  registryEndpoints,
  allowInsecureLoopback:
    process.env.RADIUS_PLATFORM_ALLOW_INSECURE_LOOPBACK === "true",
  authorizationForRegistry: () =>
    registryUsername && registryPassword
      ? `Basic ${Buffer.from(`${registryUsername}:${registryPassword}`).toString("base64")}`
      : undefined,
});
const processJob = createPlatformJobProcessor({
  registryVerifier,
  workerId: hostname(),
});
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const { pool: database } = createPlatformDatabase({
  connectionString: databaseUrl,
  applicationName: "radius-platform-outbox",
  maxConnections: 3,
});
const queue = new Queue(RADIUS_PLATFORM_JOBS_QUEUE, { connection });
const concurrency = parseConcurrency(process.env.JOBS_CONCURRENCY);
const worker = new Worker(
  RADIUS_PLATFORM_JOBS_QUEUE,
  async (job) =>
    processJob(
      PlatformJobEnvelopeSchema.parse({ name: job.name, data: job.data }),
    ),
  { connection, concurrency },
);

worker.on("completed", (job) => {
  console.info(`[platform-jobs] completed ${job.name} ${job.id}`);
});
worker.on("failed", (job, error) => {
  console.error(
    `[platform-jobs] failed ${job?.name ?? "unknown"} ${job?.id ?? "unknown"}`,
    error,
  );
});
worker.on("error", (error) => {
  console.error("[platform-jobs] worker error", error);
});

let stopping = false;
void runOutboxLoop();

async function runOutboxLoop(): Promise<void> {
  let pollDelayMs = 500;
  while (!stopping) {
    try {
      const published = await dispatchPlatformOutbox(database, queue);
      if (published > 0) {
        console.info(
          `[platform-jobs] published ${published} outbox message(s)`,
        );
      }
      pollDelayMs = published > 0 ? 500 : Math.min(pollDelayMs * 2, 2_000);
    } catch (error) {
      console.error("[platform-jobs] outbox dispatch failed", error);
      pollDelayMs = 2_000;
    }
    await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
  }
}

async function shutdown(signal: string): Promise<void> {
  console.info(`[platform-jobs] received ${signal}; shutting down`);
  stopping = true;
  await worker.close();
  await queue.close();
  await database.end();
  connection.disconnect();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

console.info(
  `[platform-jobs] listening on ${RADIUS_PLATFORM_JOBS_QUEUE} with concurrency ${concurrency}`,
);

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseConcurrency(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "5", 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("JOBS_CONCURRENCY must be an integer from 1 to 100");
  }
  return parsed;
}

function parseRegistryEndpoints(
  value: string | undefined,
): Record<string, string> {
  if (!value?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("RADIUS_PLATFORM_REGISTRY_ENDPOINTS must be a JSON object");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((endpoint) => typeof endpoint !== "string")
  ) {
    throw new Error(
      "RADIUS_PLATFORM_REGISTRY_ENDPOINTS must map registry hosts to hosts",
    );
  }
  return parsed as Record<string, string>;
}
