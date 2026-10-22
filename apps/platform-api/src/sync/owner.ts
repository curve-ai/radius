import { sql } from "drizzle-orm";

import type { PlatformDatabase } from "@curve-ai/platform-database";

export type PlatformTransaction = Parameters<
  Parameters<PlatformDatabase["transaction"]>[0]
>[0];

/**
 * Every radius_sync table carries a row-level security policy that admits
 * only rows owned by the membership named in the `radius_sync.membership_id`
 * setting. This opens a transaction with that setting in place, so the
 * queries inside see exactly one member's conversations and nothing else,
 * whether or not they remember to filter. The setting is transaction-local
 * and gone once the transaction ends, so a pooled connection never carries
 * it to the next request.
 */
export async function withSyncOwner<T>(
  database: PlatformDatabase,
  owner: { membershipId: string },
  run: (transaction: PlatformTransaction) => Promise<T>,
): Promise<T> {
  return database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('radius_sync.membership_id', ${owner.membershipId}, true)`,
    );
    return run(transaction);
  });
}
