import { Redis } from "ioredis";

const redisUrl = process.env.JOBS_REDIS_URL?.trim();
if (!redisUrl) throw new Error("JOBS_REDIS_URL is required");

const connection = new Redis(redisUrl, {
  enableOfflineQueue: false,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

try {
  await connection.connect();
  if ((await connection.ping()) !== "PONG") process.exitCode = 1;
} finally {
  connection.disconnect();
}
