import type { PlatformPool } from "@curve-ai/platform-database";
import { PlatformOrganizationSlugSchema } from "@curve-ai/platform-contracts";

import type { PlatformBrowserAuthServices } from "./app.js";
import {
  authenticateBrowserSession,
  normalizeOidcProvisioningPolicy,
  provisionOidcBrowserSession,
  revokeBrowserSession,
  type OidcProvisioningPolicy,
} from "./browser-session.js";
import {
  clearOidcTransactionCookie,
  PlatformOidcClient,
  normalizePlatformOidcOptions,
  type PlatformOidcConfiguration,
} from "./oidc.js";

const MAX_CACHED_MANAGED_ORGANIZATIONS = 256;

export interface SharedPostgresBrowserAuthOptions {
  pool: PlatformPool;
  issuer: string;
  clientIdPrefix: string;
  clientSecret?: string;
  transactionSecret: string;
  baseDomain: string;
  scopes?: readonly string[];
  sessionTtlSeconds?: number;
  sessionCookieName?: string;
  transactionCookieName?: string;
  allowInsecureLoopback?: boolean;
}

export function createSharedPostgresBrowserAuth(
  options: SharedPostgresBrowserAuthOptions,
): PlatformBrowserAuthServices {
  const allowInsecureLoopback = options.allowInsecureLoopback === true;
  const baseDomain = normalizeManagedBaseDomain(
    options.baseDomain,
    allowInsecureLoopback,
  );
  const clientIdPrefix = options.clientIdPrefix.trim();
  if (!/^[A-Za-z0-9._:-]{1,96}$/.test(clientIdPrefix)) {
    throw new Error("Managed OIDC client ID prefix is invalid");
  }
  const oidcForOrigin = (origin: string, organization: string) =>
    normalizePlatformOidcOptions({
      issuer: options.issuer,
      clientId: `${clientIdPrefix}${organization}`,
      clientSecret: options.clientSecret,
      redirectUri: new URL(
        "/api/platform/v1/auth/oidc/callback",
        origin,
      ).href,
      scopes: options.scopes,
      transactionSecret: options.transactionSecret,
      transactionCookieName: options.transactionCookieName,
      allowInsecureLoopback,
    });
  const cookieConfiguration = oidcForOrigin(
    `https://placeholder.${baseDomain}`,
    "placeholder",
  );
  const services = new Map<string, PlatformBrowserAuthServices>();
  const serviceFor = (requestUrl: URL): PlatformBrowserAuthServices => {
    const organization = organizationFromManagedHost(
      requestUrl,
      baseDomain,
      allowInsecureLoopback,
    );
    let service = services.get(organization);
    if (service) return service;
    const applicationBaseUrl = new URL(requestUrl.origin);
    const oidc = oidcForOrigin(applicationBaseUrl.href, organization);
    service = createPostgresBrowserAuth({
      pool: options.pool,
      oidc,
      provisioning: normalizeOidcProvisioningPolicy({
        organizationSlug: organization,
        allowUnprovisionedIdentities: false,
        sessionTtlSeconds: options.sessionTtlSeconds,
      }),
      applicationBaseUrl: applicationBaseUrl.href,
      sessionCookieName: options.sessionCookieName,
    });
    if (services.size >= MAX_CACHED_MANAGED_ORGANIZATIONS) {
      const oldest = services.keys().next().value;
      if (oldest) services.delete(oldest);
    }
    services.set(organization, service);
    return service;
  };
  const sessionAuth = createPostgresBrowserSessionAuth({
    pool: options.pool,
    sessionCookieName: options.sessionCookieName,
    secureCookies: !allowInsecureLoopback,
  });
  return {
    ...sessionAuth,
    organizationForRequest: async (requestUrl) =>
      organizationFromManagedHost(
        requestUrl,
        baseDomain,
        allowInsecureLoopback,
      ),
    oidc: {
      transactionCookieName: cookieConfiguration.transactionCookieName,
      clearTransactionCookie: () =>
        clearOidcTransactionCookie(cookieConfiguration),
      loginErrorUrl: (requestUrl) =>
        serviceFor(requestUrl).oidc!.loginErrorUrl(requestUrl),
      begin: (returnTo, requestUrl) =>
        serviceFor(requestUrl).oidc!.begin(returnTo, requestUrl),
      complete: (callbackUrl, transactionCookie) =>
        serviceFor(callbackUrl).oidc!.complete(callbackUrl, transactionCookie),
    },
  };
}

export function organizationFromManagedHost(
  requestUrl: URL,
  baseDomain: string,
  allowInsecureLoopback = false,
): string {
  if (
    requestUrl.protocol !== "https:" &&
    !(
      allowInsecureLoopback &&
      requestUrl.protocol === "http:" &&
      requestUrl.hostname.endsWith(".localhost")
    )
  ) {
    throw new Error("Managed organization origins must use HTTPS");
  }
  const suffix = `.${normalizeManagedBaseDomain(baseDomain, allowInsecureLoopback)}`;
  const hostname = requestUrl.hostname.toLowerCase();
  if (!hostname.endsWith(suffix)) {
    throw new Error("Managed organization host is not allowlisted");
  }
  const label = hostname.slice(0, -suffix.length);
  if (!PlatformOrganizationSlugSchema.safeParse(label).success) {
    throw new Error("Managed organization host is invalid");
  }
  return label;
}

function normalizeManagedBaseDomain(
  value: string,
  allowInsecureLoopback = false,
): string {
  const domain = value.trim().toLowerCase();
  if (allowInsecureLoopback && domain === "localhost") return domain;
  if (
    !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(domain) ||
    !domain.includes(".")
  ) {
    throw new Error("Managed base domain is invalid");
  }
  return domain;
}

export interface PostgresBrowserAuthOptions {
  pool: PlatformPool;
  oidc: PlatformOidcConfiguration;
  provisioning: OidcProvisioningPolicy;
  applicationBaseUrl: string;
  sessionCookieName?: string;
}

export function createPostgresBrowserAuth(
  options: PostgresBrowserAuthOptions,
): PlatformBrowserAuthServices {
  const oidc = new PlatformOidcClient(options.oidc);
  const applicationBaseUrl = validateApplicationBaseUrl(
    options.applicationBaseUrl,
    options.oidc.allowInsecureLoopback,
  );
  const sessionAuth = createPostgresBrowserSessionAuth({
    pool: options.pool,
    sessionCookieName: options.sessionCookieName,
    secureCookies: options.oidc.secureCookies,
  });

  return {
    ...sessionAuth,
    oidc: {
      transactionCookieName: options.oidc.transactionCookieName,
      clearTransactionCookie: () => clearOidcTransactionCookie(options.oidc),
      loginErrorUrl: () => new URL("/login?error=oidc", applicationBaseUrl),
      begin: async (returnTo) => {
        const started = await oidc.begin(returnTo);
        return {
          authorizationUrl: started.authorizationUrl,
          setCookie: started.setCookie,
        };
      },
      complete: async (callbackUrl, transactionCookie) => {
        const completed = await oidc.complete(callbackUrl, transactionCookie);
        const session = await provisionOidcBrowserSession(
          options.pool,
          completed.claims,
          options.provisioning,
        );
        const maxAge = Math.max(
          0,
          Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000),
        );
        return {
          identity: session.identity,
          redirectUrl: new URL(completed.returnTo, applicationBaseUrl),
          sessionCookie: serializeSessionCookie(
            sessionAuth.sessionCookieName,
            session.sessionToken,
            maxAge,
            options.oidc.secureCookies,
          ),
          clearTransactionCookie: completed.clearCookie,
        };
      },
    },
  };
}

export function createPostgresBrowserSessionAuth(options: {
  pool: PlatformPool;
  sessionCookieName?: string;
  secureCookies: boolean;
}): PlatformBrowserAuthServices {
  const sessionCookieName =
    options.sessionCookieName?.trim() || "radius_platform_session";
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(sessionCookieName)) {
    throw new Error("Platform session cookie name is invalid");
  }
  return {
    sessionCookieName,
    authenticate: async (sessionToken) =>
      (await authenticateBrowserSession(options.pool, sessionToken))
        ?.identity ?? null,
    revoke: async (sessionToken) =>
      revokeBrowserSession(options.pool, sessionToken),
    clearSessionCookie: () =>
      serializeSessionCookie(sessionCookieName, "", 0, options.secureCookies),
  };
}

function serializeSessionCookie(
  name: string,
  value: string,
  maxAge: number,
  secure: boolean,
): string {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function validateApplicationBaseUrl(
  value: string,
  allowInsecureLoopback: boolean,
): URL {
  const url = new URL(value);
  const loopback =
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname) ||
    url.hostname.endsWith(".localhost");
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && loopback && allowInsecureLoopback)
  ) {
    throw new Error(
      "Platform application URL must use HTTPS except explicit loopback development",
    );
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}
