import * as oidc from "openid-client";
import { readBoundedText, resolveRequestUrl } from "./app.js";
import { Hono, type Context } from "hono";
import {
  NativeAuthorizationRequestSchema,
  NativeOAuthConfigurationSchema,
  type NativeOAuthConfiguration,
} from "@curve-ai/platform-contracts";
import type { PlatformPool } from "@curve-ai/platform-database";
import {
  authenticateBrowserSession,
  normalizeOidcProvisioningPolicy,
  provisionOidcBrowserSession,
  revokeBrowserSession,
  type OidcProvisioningPolicy,
} from "./browser-session.js";
import { organizationFromManagedHost } from "./browser-auth.js";
import type { OidcIdentityClaims } from "./oidc.js";

export function validateNativeConfiguration(
  value: unknown,
  allowLoopback = false,
): NativeOAuthConfiguration {
  const config = NativeOAuthConfigurationSchema.parse(value);
  for (const input of [config.issuer, config.resource]) {
    const url = new URL(input);
    const local =
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.hostname.endsWith(".localhost");
    if (
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      (url.protocol !== "https:" &&
        !(allowLoopback && local && url.protocol === "http:"))
    )
      throw new Error("Native OAuth issuer and resource must use HTTPS");
  }
  const redirect = new URL(config.redirectUri);
  if (
    redirect.protocol !== "http:" ||
    redirect.hostname !== "127.0.0.1" ||
    !redirect.port ||
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash ||
    redirect.pathname !== "/callback"
  )
    throw new Error("Native callback must be http://127.0.0.1:<port>/callback");
  if (!config.scopes.includes("openid"))
    throw new Error("Native OAuth requires openid");
  return config;
}

export function nativeCallback(
  config: NativeOAuthConfiguration,
  request: { callbackUrl: string; state: string },
): URL {
  const callback = new URL(request.callbackUrl);
  const redirect = new URL(config.redirectUri);
  if (
    callback.origin !== redirect.origin ||
    callback.pathname !== redirect.pathname ||
    callback.hash ||
    callback.username ||
    callback.password ||
    callback.searchParams.getAll("state").length !== 1 ||
    callback.searchParams.get("state") !== request.state ||
    callback.searchParams.getAll("code").length !== 1 ||
    !callback.searchParams.get("code") ||
    callback.searchParams.has("error")
  )
    throw new Error("Native callback is invalid");
  return callback;
}

interface NativeEntry {
  config: NativeOAuthConfiguration;
  policy: OidcProvisioningPolicy;
}

export function createNativeAuthRoutes(options: {
  pool: PlatformPool;
  entries: NativeEntry[];
  managedBaseDomain?: string;
  allowLoopback?: boolean;
}) {
  const app = new Hono();
  const clients = new Map<string, Promise<oidc.Configuration>>();
  if (!options.managedBaseDomain && options.entries.length !== 1)
    throw new Error("Self-hosted native auth requires one organization");
  // Provider exceptions can contain codes, tokens, URLs and personal claims.
  app.onError((_error, context) =>
    context.json({ error: "NATIVE_AUTH_FAILED" }, 401),
  );
  const entryFor = (context: Context): NativeEntry => {
    const organization = options.managedBaseDomain
      ? organizationFromManagedHost(
          resolveRequestUrl(context, true),
          options.managedBaseDomain,
          options.allowLoopback,
        )
      : options.entries[0]?.config.organizationSlug;
    const entry = options.entries.find(
      (candidate) => candidate.config.organizationSlug === organization,
    );
    if (!entry) throw new Error("Native authentication is not configured");
    return entry;
  };
  const clientFor = (config: NativeOAuthConfiguration) => {
    let client = clients.get(config.organizationSlug);
    if (!client) {
      client = oidc.discovery(
        new URL(config.issuer),
        config.clientId,
        undefined,
        oidc.None(),
        {
          timeout: 15,
          execute: [
            oidc.enableNonRepudiationChecks,
            ...(options.allowLoopback ? [oidc.allowInsecureRequests] : []),
          ],
        },
      );
      clients.set(config.organizationSlug, client);
      void client.catch(() => clients.delete(config.organizationSlug));
    }
    return client;
  };
  app.use("*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    context.header("Pragma", "no-cache");
    await next();
  });
  app.get("/config", async (context) => {
    const entry = entryFor(context);
    const metadata = (await clientFor(entry.config)).serverMetadata();
    if (!metadata.authorization_endpoint)
      return context.json({ error: "NATIVE_AUTH_UNAVAILABLE" }, 503);
    return context.json({
      ...entry.config,
      authorizationEndpoint: metadata.authorization_endpoint,
    });
  });
  const readBody = async (request: Request) => {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new Error("JSON required");
    if (!request.body) throw new Error("Body required");
    return JSON.parse(
      await readBoundedText(
        request.body,
        32768,
        () => new Error("Body too large"),
      ),
    );
  };
  const finish = async (
    entry: NativeEntry,
    tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers,
    oldToken?: string,
  ) => {
    const claims = tokens.claims();
    if (!claims || claims.iss !== entry.config.issuer || !claims.sub)
      throw new Error("OIDC identity required");
    const scopes = (tokens.scope ?? entry.config.scopes.join(" "))
      .split(" ")
      .filter(Boolean);
    if (
      entry.config.scopes.some(
        (scope) => scope !== "offline_access" && !scopes.includes(scope),
      )
    )
      throw new Error("Missing required scope");
    if (
      !tokens.access_token ||
      typeof tokens.expires_in !== "number" ||
      tokens.expires_in <= 0 ||
      tokens.expires_in > 86400 ||
      tokens.token_type.toLowerCase() !== "bearer"
    )
      throw new Error("Expiring bearer access token required");
    const identityClaims: OidcIdentityClaims = {
      issuer: claims.iss,
      subject: claims.sub,
      email:
        typeof claims.email === "string"
          ? claims.email.trim().toLowerCase()
          : null,
      emailVerified: claims.email_verified === true,
      displayName:
        typeof claims.name === "string" ? claims.name.slice(0, 120) : null,
    };
    if (oldToken) {
      const previous = await authenticateBrowserSession(options.pool, oldToken);
      if (!previous) throw new Error("Session expired");
      const binding = await options.pool.query<{
        issuer: string;
        provider_subject: string;
      }>(
        "SELECT issuer, provider_subject FROM radius_platform.account_identities WHERE account_identity_id = $1",
        [previous.accountIdentityId],
      );
      if (
        binding.rows[0]?.issuer !== claims.iss ||
        binding.rows[0]?.provider_subject !== claims.sub
      )
        throw new Error("Identity changed");
    }
    const created = await provisionOidcBrowserSession(
      options.pool,
      identityClaims,
      entry.policy,
      { organizationBound: true },
    );
    const organization = created.identity.organizations.find(
      (org) => org.slug === entry.config.organizationSlug,
    );
    if (!organization) {
      await revokeBrowserSession(options.pool, created.sessionToken);
      throw new Error("Membership required");
    }
    if (oldToken) await revokeBrowserSession(options.pool, oldToken);
    return {
      platformSessionToken: created.sessionToken,
      platformExpiresAt: created.expiresAt,
      accountId: created.identity.accountId,
      organization,
      agent: {
        accessToken: tokens.access_token,
        expiresAt: new Date(
          Date.now() + tokens.expires_in * 1000,
        ).toISOString(),
        scopes,
      },
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    };
  };
  app.post("/exchange", async (context) => {
    const entry = entryFor(context);
    const input = NativeAuthorizationRequestSchema.parse(
      await readBody(context.req.raw),
    );
    const tokens = await oidc.authorizationCodeGrant(
      await clientFor(entry.config),
      nativeCallback(entry.config, input),
      {
        pkceCodeVerifier: input.codeVerifier,
        expectedState: input.state,
        expectedNonce: input.nonce,
      },
      { resource: entry.config.resource },
    );
    return context.json(await finish(entry, tokens));
  });
  app.post("/refresh", async (context) => {
    const token = context.req
      .header("authorization")
      ?.match(/^Bearer (radius_native_[A-Za-z0-9_-]+)$/)?.[1];
    if (!token) throw new Error("Session required");
    const previous = await authenticateBrowserSession(options.pool, token);
    if (!previous) throw new Error("Session required");
    const entry = entryFor(context);
    if (
      !previous?.identity.organizations.some(
        (organization) => organization.slug === entry.config.organizationSlug,
      )
    )
      throw new Error("Native session belongs to another organization");
    const body = await readBody(context.req.raw);
    if (
      typeof body.refreshToken !== "string" ||
      body.refreshToken.length > 16384 ||
      !body.refreshToken
    )
      throw new Error("Refresh token required");
    const tokens = await oidc.refreshTokenGrant(
      await clientFor(entry.config),
      body.refreshToken,
      { resource: entry.config.resource },
    );
    // This v1 contract requires an ID token on refresh to revalidate identity.
    return context.json(await finish(entry, tokens, token));
  });
  app.post("/logout", async (context) => {
    const token = context.req
      .header("authorization")
      ?.match(/^Bearer (radius_native_[A-Za-z0-9_-]+)$/)?.[1];
    if (token) await revokeBrowserSession(options.pool, token);
    return context.json({ ok: true });
  });
  return app;
}

export function nativeEntriesFromEnvironment(
  environment: NodeJS.ProcessEnv,
): NativeEntry[] {
  if (!environment.RADIUS_NATIVE_AUTH_CONFIG) return [];
  const entries: unknown = JSON.parse(environment.RADIUS_NATIVE_AUTH_CONFIG);
  if (!Array.isArray(entries) || !entries.length || entries.length > 256)
    throw new Error(
      "Native auth configuration must be an array of 1–256 organizations",
    );
  const seen = new Set<string>();
  const clients = new Set<string>();
  return entries.map((entry) => {
    const config = validateNativeConfiguration(
      entry,
      environment.RADIUS_OIDC_ALLOW_INSECURE_LOOPBACK === "true",
    );
    if (seen.has(config.organizationSlug))
      throw new Error("Duplicate native organization");
    seen.add(config.organizationSlug);
    const clientKey = `${config.issuer}\0${config.clientId}`;
    if (clients.has(clientKey))
      throw new Error(
        "Use a separate native OAuth client for each organization",
      );
    clients.add(clientKey);
    return {
      config,
      policy: normalizeOidcProvisioningPolicy({
        organizationSlug: config.organizationSlug,
        allowUnprovisionedIdentities:
          environment.RADIUS_PLATFORM_SHARED_ORIGINS !== "true" &&
          environment.RADIUS_NATIVE_AUTO_JOIN === "true",
        allowedEmailDomains:
          environment.RADIUS_OIDC_ALLOWED_EMAIL_DOMAINS?.split(","),
        allowedEmails: environment.RADIUS_OIDC_ALLOWED_EMAILS?.split(","),
        role: environment.RADIUS_OIDC_AUTO_JOIN_ROLE,
      }),
    };
  });
}
