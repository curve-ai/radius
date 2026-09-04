import { customType, pgSchema } from "drizzle-orm/pg-core";

export const radiusPlatform = pgSchema("radius_platform");

// Conversation sync keeps its own namespace. It is a data plane of its own
// and is scoped by organization like every other platform table.
export const radiusSync = pgSchema("radius_sync");

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const now = () => new Date();
