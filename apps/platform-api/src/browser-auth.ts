import type { PlatformPool } from "@curve-ai/platform-database";

import type { PlatformBrowserAuthServices } from "./app.js";
import {
  authenticateBrowserSession,
  provisionOidcBrowserSession,
  revokeBrowserSession,
  type OidcProvisioningPolicy,
} from "./browser-session.js";
import {
  clearOidcTransactionCookie,
  PlatformOidcClient,
  type PlatformOidcConfiguration,
} from "./oidc.js";

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
  const sessionCookieName =
    options.sessionCookieName?.trim() || "radius_platform_session";
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(sessionCookieName)) {
    throw new Error("Platform session cookie name is invalid");
  }

  const clearSessionCookie = () =>
    serializeSessionCookie(
      sessionCookieName,
      "",
      0,
      options.oidc.secureCookies,
    );

  return {
    sessionCookieName,
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
            sessionCookieName,
            session.sessionToken,
            maxAge,
            options.oidc.secureCookies,
          ),
          clearTransactionCookie: completed.clearCookie,
        };
      },
    },
    authenticate: async (sessionToken) =>
      (await authenticateBrowserSession(options.pool, sessionToken))
        ?.identity ?? null,
    revoke: async (sessionToken) =>
      revokeBrowserSession(options.pool, sessionToken),
    clearSessionCookie,
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
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
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
