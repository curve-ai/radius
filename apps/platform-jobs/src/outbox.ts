import {
  withPlatformTransaction,
  type PlatformPool,
} from "@curve-ai/platform-database";
import { PlatformJobEnvelopeSchema } from "@curve-ai/platform-job-contracts";
import type { Queue } from "bullmq";

export async function dispatchPlatformOutbox(
  pool: PlatformPool,
  queue: Pick<Queue, "add">,
  limit = 25,
): Promise<number> {
  return withPlatformTransaction(pool, async (client) => {
    const result = await client.query<{
      outbox_message_id: string;
      job_name: string;
      payload: unknown;
    }>(
      `
        SELECT outbox_message_id, job_name, payload
        FROM radius_platform.job_outbox_messages
        WHERE message_state = 'pending'
          AND available_at <= clock_timestamp()
        ORDER BY available_at, outbox_message_id
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      `,
      [limit],
    );
    let published = 0;
    for (const row of result.rows) {
      const parsed = PlatformJobEnvelopeSchema.safeParse({
        name: row.job_name,
        data: row.payload,
      });
      if (!parsed.success) {
        await client.query(
          `
            UPDATE radius_platform.job_outbox_messages
            SET message_state = 'failed',
                attempt_count = attempt_count + 1,
                terminal_error_code = 'INVALID_JOB_PAYLOAD'
            WHERE outbox_message_id = $1
          `,
          [row.outbox_message_id],
        );
        continue;
      }
      await queue.add(parsed.data.name, parsed.data.data, {
        jobId: row.outbox_message_id,
        removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
      });
      await client.query(
        `
          UPDATE radius_platform.job_outbox_messages
          SET message_state = 'published',
              attempt_count = attempt_count + 1,
              published_at = clock_timestamp()
          WHERE outbox_message_id = $1
        `,
        [row.outbox_message_id],
      );
      published += 1;
    }
    return published;
  });
}
