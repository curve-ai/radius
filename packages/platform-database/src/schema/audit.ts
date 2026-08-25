import { index, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { organizationMemberships, organizations } from "./platform.js";

const audit = pgSchema("audit");

export const auditEvents = audit.table(
  "events",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    actorMembershipId: uuid("actor_membership_id").references(
      () => organizationMemberships.id,
      { onDelete: "restrict" },
    ),
    actorType: text("actor_type").notNull(),
    eventType: text("event_type").notNull(),
    subjectKind: text("subject_kind").notNull(),
    subjectId: uuid("subject_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_events_organization_occurred_idx").on(
      table.organizationId,
      table.occurredAt,
      table.id,
    ),
    index("audit_events_subject_idx").on(
      table.organizationId,
      table.subjectKind,
      table.subjectId,
    ),
  ],
);
