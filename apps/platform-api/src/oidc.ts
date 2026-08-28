import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import * as oidc from "openid-client";

const OIDC_TRANSACTION_TTL_SECONDS = 10 * 60;

export interface PlatformOidcOptions {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes?: readonly string[];
  transactionSecret: string;
  allowInsecureLoopback?: boolean;
  transactionCookieName?: string;
}

export interface PlatformOidcConfiguration {
  issuer: URL;
  clientId: string;
  clientSecret?: string;
  redirectUri: URL;
  scopes: readonly string[];
  transactionSecret: Uint8Array;
  transactionCookieName: string;
  secureCookies: boolean;
  allowInsecureLoopback: boolean;
}

export interface OidcTransaction {
  version: 1;
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  issuedAt: number;
  expiresAt: number;
}

export interface OidcAuthorizationStart {
  authorizationUrl: URL;
  transaction: OidcTransaction;
  setCookie: string;
}

export interface OidcIdentityClaims {
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}

export class PlatformOidcClient {
  private configurationPromise: Promise<oidc.Configuration> | null = null;

  constructor(readonly options: PlatformOidcConfiguration) {}

  async begin(returnTo = "/workspace", now = new Date()): Promise<OidcAuthorizationStart> {
    const transaction: OidcTransaction = {
      version: 1,
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      codeVerifier: oidc.randomPKCECodeVerifier(),
      returnTo: normalizeReturnTo(returnTo),
      issuedAt: Math.floor(now.getTime() / 1000),
      expiresAt:
        Math.floor(now.getTime() / 1000) + OIDC_TRANSACTION_TTL_SECONDS,
    };
    const codeChallenge = await oidc.calculatePKCECodeChallenge(
      transaction.codeVerifier,
    );
    const authorizationUrl = oidc.buildAuthorizationUrl(
      await this.configuration(),
      {
        redirect_uri: this.options.redirectUri.href,
        response_type: "code",
        scope: this.options.scopes.join(" "),
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state: transaction.state,
        nonce: transaction.nonce,
      },
    );
    return {
      authorizationUrl,
      transaction,
      setCookie: serializeOidcTransactionCookie(
        this.options,
        sealOidcTransaction(transaction, this.options.transactionSecret),
      ),
    };
  }

  async complete(
    callbackUrl: URL,
    sealedTransaction: string,
    now = new Date(),
  ): Promise<{ claims: OidcIdentityClaims; returnTo: string; clearCookie: string }> {
    const transaction = openOidcTransaction(
      sealedTransaction,
      this.options.transactionSecret,
      now,
    );
    const tokens = await oidc.authorizationCodeGrant(
      await this.configuration(),
      callbackUrl,
      {
        pkceCodeVerifier: transaction.codeVerifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
      },
    );
    const claims = tokens.claims();
    if (!claims || typeof claims.sub !== "string" || typeof claims.iss !== "string") {
      throw new Error("OIDC provider did not return valid ID token identity claims");
    }
    return {
      claims: {
        issuer: claims.iss,
        subject: claims.sub,
        email:
          typeof claims.email === "string" ? claims.email.trim().toLowerCase() : null,
        emailVerified: claims.email_verified === true,
        displayName:
          typeof claims.name === "string" && claims.name.trim()
            ? claims.name.trim().slice(0, 120)
            : null,
      },
      returnTo: transaction.returnTo,
      clearCookie: clearOidcTransactionCookie(this.options),
    };
  }

  private configuration(): Promise<oidc.Configuration> {
    this.configurationPromise ??= oidc.discovery(
      this.options.issuer,
      this.options.clientId,
      {
        redirect_uris: [this.options.redirectUri.href],
        response_types: ["code"],
      },
      this.options.clientSecret
        ? oidc.ClientSecretBasic(this.options.clientSecret)
        : oidc.None(),
      this.options.allowInsecureLoopback
        ? { execute: [oidc.allowInsecureRequests] }
        : undefined,
    );
    return this.configurationPromise;
  }
}

export function normalizePlatformOidcOptions(
  options: PlatformOidcOptions,
): PlatformOidcConfiguration {
  const issuer = validateOidcUrl(options.issuer, options.allowInsecureLoopback);
  const redirectUri = validateOidcUrl(
    options.redirectUri,
    options.allowInsecureLoopback,
  );
  const clientId = options.clientId.trim();
  if (!clientId || clientId.length > 512) throw new Error("OIDC client ID is invalid");
  const clientSecret = options.clientSecret?.trim() || undefined;
  const scopes = [...new Set((options.scopes ?? ["openid", "email", "profile"]).map((scope) => scope.trim()))];
  if (!scopes.includes("openid")) throw new Error("OIDC scopes must include openid");
  if (scopes.some((scope) => !/^[A-Za-z0-9._:-]{1,128}$/.test(scope))) {
    throw new Error("OIDC scope is invalid");
  }
  const transactionSecret = Buffer.from(options.transactionSecret, "base64url");
  if (transactionSecret.byteLength < 32) {
    throw new Error("OIDC transaction secret must contain at least 32 random bytes");
  }
  const transactionCookieName =
    options.transactionCookieName?.trim() || "radius_oidc_transaction";
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(transactionCookieName)) {
    throw new Error("OIDC transaction cookie name is invalid");
  }
  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    scopes,
    transactionSecret,
    transactionCookieName,
    secureCookies: redirectUri.protocol === "https:",
    allowInsecureLoopback: options.allowInsecureLoopback === true,
  };
}

export function sealOidcTransaction(
  transaction: OidcTransaction,
  secret: Uint8Array,
): string {
  const payload = Buffer.from(JSON.stringify(transaction)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function openOidcTransaction(
  sealed: string,
  secret: Uint8Array,
  now = new Date(),
): OidcTransaction {
  const [payload, signature, extra] = sealed.split(".");
  if (!payload || !signature || extra !== undefined) {
    throw new Error("OIDC transaction cookie is invalid");
  }
  const expected = createHmac("sha256", secret).update(payload).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    throw new Error("OIDC transaction cookie is invalid");
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("OIDC transaction cookie signature is invalid");
  }
  let transaction: OidcTransaction;
  try {
    transaction = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("OIDC transaction cookie payload is invalid");
  }
  validateTransaction(transaction);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (transaction.expiresAt < nowSeconds || transaction.issuedAt > nowSeconds + 30) {
    throw new Error("OIDC transaction cookie expired");
  }
  return transaction;
}

function serializeOidcTransactionCookie(
  options: PlatformOidcConfiguration,
  value: string,
): string {
  return cookie(options, value, OIDC_TRANSACTION_TTL_SECONDS);
}

export function clearOidcTransactionCookie(options: PlatformOidcConfiguration): string {
  return cookie(options, "", 0);
}

function cookie(
  options: PlatformOidcConfiguration,
  value: string,
  maxAge: number,
): string {
  return [
    `${options.transactionCookieName}=${value}`,
    "Path=/api/platform/v1/auth/oidc",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    ...(options.secureCookies ? ["Secure"] : []),
  ].join("; ");
}

function validateOidcUrl(value: string, allowInsecureLoopback = false): URL {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && loopback && allowInsecureLoopback)
  ) {
    throw new Error("OIDC URLs must use HTTPS except explicit loopback development");
  }
  if (url.username || url.password || url.hash) throw new Error("OIDC URL is invalid");
  return url;
}

function normalizeReturnTo(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.length > 2048) {
    throw new Error("OIDC return path is invalid");
  }
  return value;
}

function validateTransaction(value: unknown): asserts value is OidcTransaction {
  if (!value || typeof value !== "object") throw new Error("OIDC transaction is invalid");
  const transaction = value as Partial<OidcTransaction>;
  if (
    transaction.version !== 1 ||
    typeof transaction.state !== "string" ||
    transaction.state.length < 16 ||
    typeof transaction.nonce !== "string" ||
    transaction.nonce.length < 16 ||
    typeof transaction.codeVerifier !== "string" ||
    transaction.codeVerifier.length < 43 ||
    typeof transaction.returnTo !== "string" ||
    typeof transaction.issuedAt !== "number" ||
    typeof transaction.expiresAt !== "number"
  ) {
    throw new Error("OIDC transaction is invalid");
  }
  normalizeReturnTo(transaction.returnTo);
}

export function generateOidcTransactionSecret(): string {
  return randomBytes(32).toString("base64url");
}
