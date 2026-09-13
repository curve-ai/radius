import { sql, type SQL } from "drizzle-orm";
import { customType, pgPolicy, pgSchema } from "drizzle-orm/pg-core";

export const radiusPlatform = pgSchema("radius_platform");

// Conversation sync keeps its own namespace. It is a data plane of its own
// and is scoped by organization like every other platform table.
export const radiusSync = pgSchema("radius_sync");

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const now = () => new Date();

// Conversation sync rows belong to one membership, and PostgreSQL enforces
// that itself: every radius_sync table carries a row-level security policy
// keyed on the `radius_sync.membership_id` setting, which the platform API
// sets for the duration of each sync transaction. With the setting absent
// the policy admits no rows, so a query that forgets its filter returns
// nothing rather than another member's conversations. Tables without a
// membership column are owned through the session event, artifact, or task
// plan they hang off, whose own policies apply inside the subquery.
const syncOwner = sql.raw(
  "nullif(current_setting('radius_sync.membership_id', true), '')::uuid",
);

function syncOwnerPolicy(table: string, predicate: SQL) {
  return pgPolicy(`${table}_membership_isolation`, {
    for: "all",
    using: predicate,
    withCheck: predicate,
  });
}

export function ownedByMembership(table: string) {
  return syncOwnerPolicy(table, sql`membership_id = ${syncOwner}`);
}

export function ownedThroughEvent(table: string, column = "event_id") {
  return syncOwnerPolicy(
    table,
    sql`exists (select 1 from radius_sync.session_events owner_event where owner_event.event_id = ${sql.raw(`${table}.${column}`)} and owner_event.membership_id = ${syncOwner})`,
  );
}

export function ownedThroughArtifact(table: string) {
  return syncOwnerPolicy(
    table,
    sql`exists (select 1 from radius_sync.artifacts owner_artifact where owner_artifact.artifact_id = ${sql.raw(`${table}.artifact_id`)} and owner_artifact.membership_id = ${syncOwner})`,
  );
}

export function ownedThroughPlan(table: string) {
  return syncOwnerPolicy(
    table,
    sql`exists (select 1 from radius_sync.task_plans owner_plan join radius_sync.session_events owner_event on owner_event.event_id = owner_plan.event_id where owner_plan.plan_id = ${sql.raw(`${table}.plan_id`)} and owner_event.membership_id = ${syncOwner})`,
  );
}
