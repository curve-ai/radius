import assert from "node:assert/strict";
import test from "node:test";

import {
  generateOidcTransactionSecret,
  normalizePlatformOidcOptions,
  openOidcTransaction,
  sealOidcTransaction,
  type OidcTransaction,
} from "./oidc.js";
import { readCookie } from "./cookies.js";

test("normalizes strict HTTPS OIDC configuration", () => {
  const options = normalizePlatformOidcOptions({
    issuer: "https://id.example.com",
    clientId: "radius",
    redirectUri:
      "https://platform.example.com/api/platform/v1/auth/oidc/callback",
    transactionSecret: generateOidcTransactionSecret(),
  });
  assert.deepEqual(options.scopes, ["openid", "email", "profile"]);
  assert.equal(options.secureCookies, true);
  assert.throws(() =>
    normalizePlatformOidcOptions({
      issuer: "http://id.example.com",
      clientId: "radius",
      redirectUri: "https://platform.example.com/callback",
      transactionSecret: generateOidcTransactionSecret(),
    }),
  );
});

test("allows insecure OIDC only for explicit loopback development", () => {
  const options = normalizePlatformOidcOptions({
    issuer: "http://127.0.0.1:5556",
    clientId: "radius",
    redirectUri: "http://127.0.0.1:3110/api/platform/v1/auth/oidc/callback",
    transactionSecret: generateOidcTransactionSecret(),
    allowInsecureLoopback: true,
  });
  assert.equal(options.secureCookies, false);
});

test("signs, validates, expires, and rejects tampered OIDC transactions", () => {
  const secret = Buffer.from(generateOidcTransactionSecret(), "base64url");
  const transaction: OidcTransaction = {
    version: 1,
    state: "s".repeat(32),
    nonce: "n".repeat(32),
    codeVerifier: "v".repeat(64),
    returnTo: "/workspace/agents",
    issuedAt: 100,
    expiresAt: 700,
  };
  const sealed = sealOidcTransaction(transaction, secret);
  assert.deepEqual(
    openOidcTransaction(sealed, secret, new Date(200_000)),
    transaction,
  );
  assert.throws(
    () => openOidcTransaction(`${sealed}x`, secret, new Date(200_000)),
    /signature/,
  );
  assert.throws(
    () => openOidcTransaction(sealed, secret, new Date(701_000)),
    /expired/,
  );
});

test("reads exact cookie names without accepting prefixes", () => {
  assert.equal(
    readCookie(
      "radius_oidc_transaction=sealed; other=value",
      "radius_oidc_transaction",
    ),
    "sealed",
  );
  assert.equal(
    readCookie("xradius_oidc_transaction=wrong", "radius_oidc_transaction"),
    null,
  );
});
