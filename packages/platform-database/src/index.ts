export {
  bootstrapPlatformOwner,
  normalizeBootstrapOptions,
  type BootstrapPlatformOwnerOptions,
  type BootstrapPlatformOwnerResult,
} from "./bootstrap.js";
export {
  createPlatformDatabase,
  createPlatformPool,
  withPlatformTransaction,
  type PlatformDatabase,
  type PlatformDatabaseContext,
  type PlatformPool,
  type PlatformPoolClient,
  type PlatformPoolOptions,
} from "./client.js";
export * as platformSchema from "./schema/index.js";
export { migratePlatformDatabase } from "./migrations.js";
