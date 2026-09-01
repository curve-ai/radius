import { timingSafeEqual } from "node:crypto";

import { provisionPlatformOrganization } from "@curve-ai/platform-database";

import { createPlatformApp } from "./app.js";
import {
  createPostgresBrowserAuth,
  createPostgresBrowserSessionAuth,
  createSharedPostgresBrowserAuth,
} from "./browser-auth.js";
import { normalizeOidcProvisioningPolicy } from "./browser-session.js";
import { normalizePlatformOidcOptions } from "./oidc.js";
import { createPostgresPlatformServices } from "./postgres-services.js";

const developmentToken = process.env.RADIUS_PLATFORM_DEV_TOKEN?.trim();
const databaseUrl = requiredEnvironment("DATABASE_URL");
const bootstrapDevelopmentAuthority =
  process.env.RADIUS_PLATFORM_BOOTSTRAP_DEV_AUTHORITY === "true";
const sharedOrigins = process.env.RADIUS_PLATFORM_SHARED_ORIGINS === "true";

const runtime = await createPostgresPlatformServices({
  connectionString: databaseUrl,
  bootstrapDevelopmentAuthority,
  developmentAccessToken: developmentToken,
  migrationsDirectory: process.env.RADIUS_PLATFORM_MIGRATIONS_DIR,
  registry: process.env.RADIUS_PLATFORM_REGISTRY,
  registryVerification: process.env.RADIUS_PLATFORM_REGISTRY_VERIFY,
  allowInsecureRegistryVerification:
    process.env.RADIUS_PLATFORM_REGISTRY_VERIFY_INSECURE === "true",
  registryUsername: process.env.RADIUS_PLATFORM_REGISTRY_USERNAME,
  registryPassword: process.env.RADIUS_PLATFORM_REGISTRY_PASSWORD,
});

const browserAuth = browserAuthFromEnvironment(runtime.pool, sharedOrigins);
const provisioningToken =
  process.env.RADIUS_PLATFORM_PROVISIONING_TOKEN?.trim();
const provisioning = provisioningToken
  ? {
      authenticate: async (candidate: string) =>
        constantTimeEqual(candidate, provisioningToken),
      provisionOrganization: (
        request: Parameters<typeof provisionPlatformOrganization>[1],
      ) => provisionPlatformOrganization(runtime.pool, request),
    }
  : undefined;
const app = createPlatformApp(runtime.services, {
  browserAuth,
  provisioning,
  deploymentMode: sharedOrigins ? "managed" : "self_hosted",
});
const server = Bun.serve({
  port: Number(process.env.PORT ?? 3100),
  fetch: app.fetch,
});

async function shutdown(signal: string): Promise<void> {
  console.info(`[platform-api] received ${signal}; shutting down`);
  server.stop();
  await runtime.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function browserAuthFromEnvironment(
  pool: import("@curve-ai/platform-database").PlatformPool,
  sharedOrigins: boolean,
) {
  const issuer = process.env.RADIUS_OIDC_ISSUER?.trim();
  const oidcEnvironmentPresent = Object.keys(process.env).some(
    (name) => name.startsWith("RADIUS_OIDC_") && process.env[name]?.trim(),
  );
  if (!issuer) {
    if (oidcEnvironmentPresent) {
      throw new Error("RADIUS_OIDC_ISSUER is required when OIDC is configured");
    }
    return createPostgresBrowserSessionAuth({
      pool,
      sessionCookieName: process.env.RADIUS_PLATFORM_SESSION_COOKIE,
      secureCookies:
        process.env.RADIUS_PLATFORM_ALLOW_INSECURE_SESSIONS !== "true",
    });
  }
  const required = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required when OIDC is configured`);
    return value;
  };
  const allowInsecureLoopback =
    process.env.RADIUS_OIDC_ALLOW_INSECURE_LOOPBACK === "true";
  const ttl = process.env.RADIUS_OIDC_SESSION_TTL_SECONDS?.trim();
  if (sharedOrigins) {
    return createSharedPostgresBrowserAuth({
      pool,
      issuer,
      clientIdPrefix: required("RADIUS_OIDC_CLIENT_ID_PREFIX"),
      clientSecret: process.env.RADIUS_OIDC_CLIENT_SECRET,
      transactionSecret: required("RADIUS_OIDC_TRANSACTION_SECRET"),
      baseDomain: required("RADIUS_MANAGED_BASE_DOMAIN"),
      scopes: commaSeparated(process.env.RADIUS_OIDC_SCOPES),
      sessionTtlSeconds: ttl ? Number(ttl) : undefined,
      sessionCookieName: process.env.RADIUS_PLATFORM_SESSION_COOKIE,
      transactionCookieName: process.env.RADIUS_OIDC_TRANSACTION_COOKIE,
      allowInsecureLoopback,
    });
  }
  const oidc = normalizePlatformOidcOptions({
    issuer,
    clientId: required("RADIUS_OIDC_CLIENT_ID"),
    clientSecret: process.env.RADIUS_OIDC_CLIENT_SECRET,
    redirectUri: required("RADIUS_OIDC_REDIRECT_URI"),
    scopes: commaSeparated(process.env.RADIUS_OIDC_SCOPES),
    transactionSecret: required("RADIUS_OIDC_TRANSACTION_SECRET"),
    allowInsecureLoopback,
    transactionCookieName: process.env.RADIUS_OIDC_TRANSACTION_COOKIE,
  });
  return createPostgresBrowserAuth({
    pool,
    oidc,
    provisioning: normalizeOidcProvisioningPolicy({
      organizationSlug: required("RADIUS_OIDC_ORGANIZATION"),
      role: process.env.RADIUS_OIDC_AUTO_JOIN_ROLE,
      allowedEmails: commaSeparated(process.env.RADIUS_OIDC_ALLOWED_EMAILS),
      allowedEmailDomains: commaSeparated(
        process.env.RADIUS_OIDC_ALLOWED_EMAIL_DOMAINS,
      ),
      bootstrapAccountId: process.env.RADIUS_OIDC_BOOTSTRAP_ACCOUNT_ID,
      sessionTtlSeconds: ttl ? Number(ttl) : undefined,
    }),
    applicationBaseUrl: required("RADIUS_PLATFORM_APPLICATION_URL"),
    sessionCookieName: process.env.RADIUS_PLATFORM_SESSION_COOKIE,
  });
}

function commaSeparated(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function constantTimeEqual(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return (
    candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes)
  );
}
