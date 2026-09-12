import { timingSafeEqual } from "node:crypto";

import { provisionPlatformOrganization } from "@curve-ai/platform-database";

import {
  createNativeAuthRoutes,
  nativeEntriesFromEnvironment,
} from "./native-auth.js";
import { createPlatformApp } from "./app.js";
import {
  createPostgresBrowserAuth,
  createPostgresBrowserSessionAuth,
  createSharedPostgresBrowserAuth,
} from "./browser-auth.js";
import { normalizeOidcProvisioningPolicy } from "./browser-session.js";
import { normalizePlatformOidcOptions } from "./oidc.js";
import { createPostgresPlatformServices } from "./postgres-services.js";
import { resolveAuthIssuer } from "./auth-configuration.js";
import { isLocalDevelopmentAuth } from "./development-auth.js";
import {
  authMode,
  embeddedAuthSecret,
  embeddedAuthUrl,
} from "./embedded-auth-config.js";
import {
  createEmbeddedAuth,
  registerEmbeddedClients,
} from "./embedded-auth.js";
import { createAuthEmailSender } from "./auth-email.js";
import { createAuthUi } from "./auth-ui.js";
import { Hono } from "hono";
import { ensureDevelopmentAuthSecret } from "./development-auth-secret.js";

const developmentToken = process.env.RADIUS_PLATFORM_DEV_TOKEN?.trim();
const databaseUrl = requiredEnvironment("DATABASE_URL");
const bootstrapDevelopmentAuthority =
  process.env.RADIUS_PLATFORM_BOOTSTRAP_DEV_AUTHORITY === "true";
const sharedOrigins = process.env.RADIUS_PLATFORM_SHARED_ORIGINS === "true";
// Reject invalid operator configuration before opening storage or starting services.
const nativeEntries = nativeEntriesFromEnvironment(process.env);
const localDevelopment = isLocalDevelopmentAuth(process.env);
const embedded = authMode(process.env) === "embedded";
// Validate delivery and issuer before opening the database or applying migrations.
const emailSender = embedded ? createAuthEmailSender(process.env) : undefined;
if (embedded) {
  ensureDevelopmentAuthSecret(process.env);
  embeddedAuthSecret(process.env);
  const issuer = embeddedAuthUrl(process.env);
  if (nativeEntries.some((entry) => entry.config.issuer !== issuer))
    throw new Error(
      "Embedded native clients must use RADIUS_AUTH_URL; select external auth mode for another issuer",
    );
  if (
    process.env.RADIUS_OIDC_ISSUER === issuer &&
    process.env.RADIUS_OIDC_CLIENT_SECRET?.trim()
  )
    throw new Error(
      "The embedded dashboard uses a registered public PKCE client; omit RADIUS_OIDC_CLIENT_SECRET",
    );
}

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
// Conversation sync is opt-in: it needs a cursor secret, and a deployment
// that does not want to store conversations should not have the routes at all.
const syncEnabled = process.env.RADIUS_SYNC_ENABLED === "true";
if (syncEnabled) requiredEnvironment("RADIUS_SYNC_CURSOR_SECRET");
const app = createPlatformApp(runtime.services, {
  nativeAuth: nativeEntries.length
    ? createNativeAuthRoutes({
        pool: runtime.pool,
        entries: nativeEntries,
        managedBaseDomain: sharedOrigins
          ? requiredEnvironment("RADIUS_MANAGED_BASE_DOMAIN")
          : undefined,
        allowLoopback:
          process.env.RADIUS_OIDC_ALLOW_INSECURE_LOOPBACK === "true",
        localDevelopment,
      })
    : undefined,
  browserAuth,
  provisioning,
  deploymentMode: sharedOrigins ? "managed" : "self_hosted",
  syncDatabase: syncEnabled ? runtime.db : undefined,
});
const router = new Hono();
if (embedded) {
  const auth = createEmbeddedAuth({
    database: runtime.db,
    environment: process.env,
    sendEmail: emailSender,
  });
  await registerEmbeddedClients(
    runtime.db,
    nativeEntries.map((entry) => entry.config),
  );
  if (
    process.env.RADIUS_OIDC_CLIENT_ID &&
    process.env.RADIUS_OIDC_ISSUER === embeddedAuthUrl(process.env)
  ) {
    await registerEmbeddedClients(runtime.db, [
      {
        issuer: embeddedAuthUrl(process.env),
        clientId: process.env.RADIUS_OIDC_CLIENT_ID,
        redirectUri: requiredEnvironment("RADIUS_OIDC_REDIRECT_URI"),
        scopes: ["openid", "email", "profile"],
        resource: `${new URL(embeddedAuthUrl(process.env)).origin}/api/platform`,
        organizationSlug: requiredEnvironment("RADIUS_OIDC_ORGANIZATION"),
        displayName: "Radius dashboard",
        agentId: "radius-dashboard",
      },
    ]);
  }
  router.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  router.get("/.well-known/*", (c) => auth.handler(c.req.raw));
  router.route(
    "/",
    createAuthUi({
      directory: process.env.RADIUS_AUTH_UI_DIR,
      googleEnabled: Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
      ),
    }),
  );
}
router.route("/", app);
const server = Bun.serve({
  hostname: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 3100),
  fetch: router.fetch,
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
  const browserConfigured =
    process.env.RADIUS_OIDC_ISSUER !== undefined ||
    process.env.RADIUS_OIDC_CLIENT_ID !== undefined ||
    process.env.RADIUS_OIDC_CLIENT_ID_PREFIX !== undefined;
  const issuer = browserConfigured
    ? resolveAuthIssuer(process.env.RADIUS_OIDC_ISSUER, process.env)
    : undefined;
  const nativeSharedSettings = new Set([
    "RADIUS_OIDC_ALLOW_INSECURE_LOOPBACK",
    "RADIUS_OIDC_ALLOWED_EMAILS",
    "RADIUS_OIDC_ALLOWED_EMAIL_DOMAINS",
    "RADIUS_OIDC_AUTO_JOIN_ROLE",
  ]);
  const oidcEnvironmentPresent = Object.keys(process.env).some(
    (name) =>
      name.startsWith("RADIUS_OIDC_") &&
      process.env[name]?.trim() &&
      !(nativeEntries.length && nativeSharedSettings.has(name)),
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
