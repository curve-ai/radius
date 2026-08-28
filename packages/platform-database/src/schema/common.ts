import { customType, pgSchema } from "drizzle-orm/pg-core";

export const radiusPlatform = pgSchema("radius_platform");

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const now = () => new Date();
