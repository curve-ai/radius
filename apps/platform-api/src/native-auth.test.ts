import { PgDialect } from "drizzle-orm/pg-core";
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import type { PlatformPool } from "@curve-ai/platform-database";
import {
  createNativeAuthRoutes,
  nativeCallback,
  validateNativeConfiguration,
} from "./native-auth.js";
import {
  authenticateBrowserSession,
  normalizeOidcProvisioningPolicy,
} from "./browser-session.js";

const base = {
  issuer: "https://id.vendor.test",
  clientId: "native-client",
  redirectUri: "http://127.0.0.1:43821/callback",
  scopes: ["openid", "email", "agent:run"],
  resource: "https://agent.vendor.test",
  organizationSlug: "vendor",
  displayName: "Vendor",
  agentId: "vendor-agent",
};

test("mounted native routes bound request bodies and keep provider errors private", async () => {
  const routes = createNativeAuthRoutes({
    pool: {} as PlatformPool,
    entries: [
      {
        config: base,
        policy: normalizeOidcProvisioningPolicy({
          organizationSlug: "vendor",
          allowUnprovisionedIdentities: false,
        }),
      },
    ],
  });
  const app = new Hono().route("/native", routes);
  for (const body of [
    "not-json-private-value",
    JSON.stringify({ codeVerifier: "private-value" }),
    JSON.stringify("x".repeat(32768)),
  ]) {
    const response = await app.request("/native/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "NATIVE_AUTH_FAILED" });
  }
});

test("refresh reuses the authenticated session before contacting the provider", async () => {
  const orgId = "00000000-0000-4000-8000-000000000001";
  let sessionReads = 0;
  const pool = {
    query: async (sql: string) => {
      if (sql.includes("FROM radius_platform.platform_sessions")) {
        sessionReads++;
        return {
          rows: [
            {
              session_id: "session",
              account_identity_id: "identity",
              account_id: "account",
            },
          ],
        };
      }
      if (sql.includes("SELECT organization.organization_id"))
        return {
          rows: [
            {
              organization_id: orgId,
              slug: "vendor",
              display_name: "Vendor",
              role_code: "viewer",
            },
          ],
        };
      return { rows: [] };
    },
  } as unknown as PlatformPool;
  const routes = createNativeAuthRoutes({
    pool,
    entries: [
      {
        config: base,
        policy: normalizeOidcProvisioningPolicy({
          organizationSlug: "vendor",
          allowUnprovisionedIdentities: false,
        }),
      },
    ],
  });
  const response = await routes.request("/refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer radius_native_${orgId}_${"r".repeat(43)}`,
    },
    body: JSON.stringify({ refreshToken: "" }),
  });
  assert.equal(response.status, 401);
  assert.equal(sessionReads, 1);
});

test("native configuration rejects remote callbacks, secrets and insecure issuers", () => {
  assert.deepEqual(validateNativeConfiguration(base), base);
  for (const extra of [
    { redirectUri: "https://attacker.test/callback" },
    { redirectUri: "http://127.0.0.1:43821/other" },
    { issuer: "http://id.vendor.test" },
    { clientSecret: "must-not-ship" },
    { scopes: ["email"] },
  ])
    assert.throws(() => validateNativeConfiguration({ ...base, ...extra }));
});

test("native callback validates exact destination, singular code and state", () => {
  const state = "a".repeat(43);
  const url = `${base.redirectUri}?code=one&state=${state}`;
  assert.equal(
    nativeCallback(base, { callbackUrl: url, state }).searchParams.get("code"),
    "one",
  );
  for (const value of [
    url.replace("43821", "43822"),
    `${url}&code=two`,
    `${url}&state=other`,
    url.replace(state, "wrong"),
    `${url}&error=denied`,
  ])
    assert.throws(() => nativeCallback(base, { callbackUrl: value, state }));
});

test("real OIDC exchange validates PKCE and nonce, consumes codes and returns separate credentials", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "test-key",
    alg: "RS256",
    use: "sig",
  };
  let issuer = "";
  let serial = 0;
  const codes = new Map<string, { challenge: string; nonce: string }>();
  const provider = createServer(async (request, response) => {
    const url = new URL(request.url!, issuer);
    response.setHeader("Content-Type", "application/json");
    if (url.pathname === "/.well-known/openid-configuration") {
      response.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
        }),
      );
      return;
    }
    if (url.pathname === "/jwks") {
      response.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (url.pathname === "/token") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const input = new URLSearchParams(body);
      const code = input.get("code")!;
      const grant = codes.get(code);
      codes.delete(code);
      if (
        !grant ||
        input.get("client_id") !== base.clientId ||
        input.get("redirect_uri") !== base.redirectUri ||
        input.get("resource") !== base.resource ||
        createHash("sha256")
          .update(input.get("code_verifier") ?? "")
          .digest("base64url") !== grant.challenge
      ) {
        response.writeHead(400).end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      const idToken = await new SignJWT({
        nonce: grant.nonce,
        email: "person@vendor.test",
        email_verified: true,
      })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(issuer)
        .setAudience(base.clientId)
        .setSubject("vendor-user")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      response.end(
        JSON.stringify({
          access_token: "agent-only-token",
          token_type: "Bearer",
          expires_in: 300,
          id_token: idToken,
          scope: base.scopes.join(" "),
        }),
      );
      return;
    }
    response.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  issuer = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
  const accountId = "00000000-0000-4000-8000-000000000001";
  const orgId = "00000000-0000-4000-8000-000000000002";
  let sessions = 0;
  const query = async (sql: string) => {
    if (sql.includes("INSERT INTO radius_platform.platform_sessions"))
      sessions++;
    let rows: unknown[] = [];
    if (sql.includes("SELECT organization_id FROM"))
      rows = [{ organization_id: orgId }];
    else if (sql.includes("SELECT account_identity_id, account_id"))
      rows = [{ account_identity_id: "identity", account_id: accountId }];
    else if (sql.includes("SELECT membership_id, lifecycle_state"))
      rows = [{ membership_id: "member", lifecycle_state: "active" }];
    else if (sql.includes("SELECT organization.organization_id"))
      rows = [
        {
          organization_id: orgId,
          slug: "vendor",
          display_name: "Vendor",
          role_code: "viewer",
        },
      ];
    return { rows, rowCount: rows.length };
  };
  const pool = {
    query,
    db: {
      transaction: async (work: (transaction: unknown) => Promise<unknown>) =>
        work({
          execute: (statement: Parameters<PgDialect["sqlToQuery"]>[0]) =>
            query(new PgDialect().sqlToQuery(statement).sql),
        }),
    },
  } as unknown as PlatformPool;
  const routes = createNativeAuthRoutes({
    pool,
    entries: [
      {
        config: { ...base, issuer },
        policy: normalizeOidcProvisioningPolicy({
          organizationSlug: "vendor",
          allowUnprovisionedIdentities: false,
        }),
      },
    ],
    allowLoopback: true,
  });
  const authorization = (wrongNonce = false) => {
    const code = `code-${serial++}`;
    const verifier = "v".repeat(43);
    const nonce = "n".repeat(43);
    const state = "s".repeat(43);
    codes.set(code, {
      challenge: createHash("sha256").update(verifier).digest("base64url"),
      nonce: wrongNonce ? "different" : nonce,
    });
    return {
      callbackUrl: `${base.redirectUri}?code=${code}&state=${state}`,
      codeVerifier: verifier,
      nonce,
      state,
    };
  };
  const exchange = (body: unknown) =>
    routes.request("/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const config = await routes.request("/config");
    assert.equal(config.status, 200);
    assert.ok(!(await config.text()).includes("agent-only-token"));
    const input = authorization();
    const success = await exchange(input);
    assert.equal(success.status, 200);
    const result = await success.json();
    assert.equal(result.agent.accessToken, "agent-only-token");
    assert.match(result.platformSessionToken, /^radius_native_/);
    assert.equal(result.accountId, accountId);
    assert.equal(sessions, 1);
    assert.equal((await exchange(input)).status, 401);
    assert.equal(
      (await exchange({ ...authorization(), codeVerifier: "w".repeat(43) }))
        .status,
      401,
    );
    assert.equal((await exchange(authorization(true))).status, 401);
    assert.equal(sessions, 1);
  } finally {
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});

test("native sessions are bound to one organization and cannot change their binding", async () => {
  const orgA = "00000000-0000-4000-8000-000000000001";
  const orgB = "00000000-0000-4000-8000-000000000002";
  const token = `radius_native_${orgA}_${"r".repeat(43)}`;
  const tokenHash = createHash("sha256").update(token).digest();
  let removed = false;
  const pool = {
    query: async (sql: string, values: unknown[]) => {
      if (sql.includes("FROM radius_platform.platform_sessions"))
        return {
          rows:
            Buffer.isBuffer(values[0]) && values[0].equals(tokenHash)
              ? [
                  {
                    session_id: "session",
                    account_identity_id: "identity",
                    account_id: "account",
                  },
                ]
              : [],
        };
      if (sql.includes("SELECT organization.organization_id"))
        return {
          rows: [
            ...(!removed
              ? [
                  {
                    organization_id: orgA,
                    slug: "alpha",
                    display_name: "Alpha",
                    role_code: "viewer",
                  },
                ]
              : []),
            {
              organization_id: orgB,
              slug: "beta",
              display_name: "Beta",
              role_code: "owner",
            },
          ],
        };
      return { rows: [] };
    },
  } as unknown as PlatformPool;
  const authenticated = await authenticateBrowserSession(pool, token);
  assert.deepEqual(
    authenticated?.identity.organizations.map((org) => org.slug),
    ["alpha"],
  );
  assert.equal(
    await authenticateBrowserSession(pool, token.replace(orgA, orgB)),
    null,
  );
  removed = true;
  assert.equal(await authenticateBrowserSession(pool, token), null);
});
