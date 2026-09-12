import assert from "node:assert/strict";
import {
  createHash,
  randomBytes,
  randomUUID,
  generateKeyPairSync,
} from "node:crypto";
import { createPlatformPool } from "@curve-ai/platform-database";
import { Hono } from "hono";
import { createPostgresPlatformServices } from "../src/postgres-services.js";
import {
  createEmbeddedAuth,
  registerEmbeddedClients,
} from "../src/embedded-auth.js";
import { createNativeAuthRoutes } from "../src/native-auth.js";
import { normalizeOidcProvisioningPolicy } from "../src/browser-session.js";
import { createPlatformApp } from "../src/app.js";
import { HttpSyncProvider } from "../../../packages/sync-core/src/http-provider.js";

// Creates and removes only its own ephemeral database on the local test server.
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
assert.equal(databaseUrl.hostname, "127.0.0.1");
assert.equal(databaseUrl.pathname, "/radius_development");
const admin = createPlatformPool({ connectionString: databaseUrl.href });
const databaseName = `radius_auth_test_${Date.now()}`;
assert.match(databaseName, /^radius_auth_test_[0-9]+$/);
await admin.query(`CREATE DATABASE "${databaseName}"`);
databaseUrl.pathname = `/${databaseName}`;
let runtime:
  Awaited<ReturnType<typeof createPostgresPlatformServices>> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
try {
  runtime = await createPostgresPlatformServices({
    connectionString: databaseUrl.href,
    bootstrapDevelopmentAuthority: true,
    developmentAccessToken: "test-only-development-token",
  });
  const router = new Hono();
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: router.fetch });
  const origin = `http://127.0.0.1:${server.port}`;
  const issuer = `${origin}/api/auth`;
  const config = {
    issuer,
    clientId: "radius-desktop-development",
    redirectUri: "http://127.0.0.1:43822/callback",
    resource: `${origin}/radius-development`,
    scopes: ["openid", "email", "profile", "offline_access"],
    organizationSlug: "dev",
    displayName: "Radius integration test",
    agentId: "radius-development",
  };
  const delivered = new Map<string, string>();
  const auth = createEmbeddedAuth({
    database: runtime.db,
    environment: {
      RADIUS_AUTH_URL: issuer,
      RADIUS_OIDC_ALLOW_INSECURE_LOOPBACK: "true",
      BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
    },
    sendEmail: async (message) => {
      if (message.email === "delivery-failure@radius.example")
        throw new Error("private delivery error");
      delivered.set(message.email, message.otp);
    },
  });
  const trust = { trustedClientIds: new Set([config.clientId]) };
  await registerEmbeddedClients(runtime.db, [config], trust);
  await registerEmbeddedClients(runtime.db, [config], trust);
  const unrelatedClient = { ...config, clientId: "unrelated-client" };
  await registerEmbeddedClients(runtime.db, [unrelatedClient]);
  router.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  router.get("/.well-known/*", (c) => auth.handler(c.req.raw));
  router.route(
    "/native",
    createNativeAuthRoutes({
      pool: runtime.pool,
      entries: [
        {
          config,
          policy: normalizeOidcProvisioningPolicy({
            organizationSlug: "dev",
            allowUnprovisionedIdentities: false,
          }),
        },
      ],
      allowLoopback: true,
      localDevelopment: true,
    }),
  );
  router.route(
    "/",
    createPlatformApp(runtime.services, { syncDatabase: runtime.db }),
  );
  let cookies = new Map<string, string>();
  async function call(path: string, body?: unknown, bearer?: string) {
    const response = await fetch(new URL(path, origin), {
      method: body === undefined ? "GET" : "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: origin,
        Cookie: [...cookies]
          .map(([key, value]) => `${key}=${value}`)
          .join("; "),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const data = response.headers
      .get("content-type")
      ?.includes("application/json")
      ? await response.json()
      : { url: response.headers.get("location") };
    return { response, data };
  }
  async function authorize(
    email: string,
    client = config,
    expectConsent = false,
  ) {
    cookies = new Map();
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const url = new URL(`${issuer}/oauth2/authorize`);
    Object.entries({
      response_type: "code",
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      resource: client.resource,
      scope: client.scopes.join(" "),
      state,
      nonce,
      code_challenge: createHash("sha256")
        .update(codeVerifier)
        .digest("base64url"),
      code_challenge_method: "S256",
    }).forEach(([key, value]) => url.searchParams.set(key, value));
    const start = await call(url.href);
    assert.ok(start.data.url, `authorize status ${start.response.status}`);
    const query = new URL(start.data.url, origin).search.slice(1);
    const sent = await call("/api/auth/email-otp/send-verification-otp", {
      email,
      type: "sign-in",
      oauth_query: query,
    });
    assert.equal(sent.response.status, 200, "OTP delivery");
    const bad = await call("/api/auth/sign-in/email-otp", {
      email,
      otp: "wrong",
      oauth_query: query,
    });
    assert.ok(bad.response.status >= 400, "wrong OTP rejected");
    const signedIn = await call("/api/auth/sign-in/email-otp", {
      email,
      otp: delivered.get(email),
      oauth_query: query,
    });
    assert.ok(signedIn.data.url, `sign-in status ${signedIn.response.status}`);
    if (!expectConsent) {
      const callback = new URL(signedIn.data.url, origin);
      assert.equal(
        callback.origin + callback.pathname,
        client.redirectUri,
        "first-party login returns directly to Radius",
      );
      return { callbackUrl: callback.href, state, nonce, codeVerifier };
    }
    const consent = new URL(signedIn.data.url, origin);
    assert.equal(
      consent.pathname,
      "/consent",
      "unrelated clients still require consent",
    );
    const granted = await call("/api/auth/oauth2/consent", {
      accept: true,
      oauth_query: consent.search.slice(1),
    });
    assert.ok(granted.data.url, `consent status ${granted.response.status}`);
    return { callbackUrl: granted.data.url, state, nonce, codeVerifier };
  }
  const failedDelivery = await call(
    "/api/auth/email-otp/send-verification-otp",
    { email: "delivery-failure@radius.example", type: "sign-in" },
  );
  assert.equal(
    failedDelivery.response.status,
    503,
    "failed email delivery must not claim success",
  );
  const input = await authorize("first@radius.example");
  const exchange = await call("/native/exchange", input);
  assert.equal(exchange.response.status, 200, "native exchange");
  assert.equal(exchange.data.organization.slug, "dev");
  assert.equal(exchange.data.profile.email, "first@radius.example", "verified identity presentation is returned without tokens");
  assert.ok(exchange.data.refreshToken, "refresh credential issued");
  const keys = generateKeyPairSync("ed25519");
  const syncProvider = new HttpSyncProvider({
    endpoint: `${origin}/api/platform/v1/sync/`,
    identity: {
      clientInstanceId: randomUUID(),
      displayName: "Auth integration device",
      platform: "test",
      publicKeyJwk: keys.publicKey.export({ format: "jwk" }),
      privateKeyJwk: keys.privateKey.export({ format: "jwk" }),
      appVersion: "test",
    },
    getAccessToken: async () => exchange.data.platformSessionToken,
  });
  await syncProvider.registerDevice();
  assert.ok(
    (await syncProvider.capabilities()).protocolVersions.includes(1),
    "native session survives workspace sync preparation",
  );
  assert.ok(
    await runtime.services.authenticateBrowserSession(
      exchange.data.platformSessionToken,
    ),
  );
  const renewed = await call(
    "/native/refresh",
    { refreshToken: exchange.data.refreshToken },
    exchange.data.platformSessionToken,
  );
  assert.equal(renewed.response.status, 200, "session refresh");
  assert.equal(
    await runtime.services.authenticateBrowserSession(
      exchange.data.platformSessionToken,
    ),
    null,
    "old Platform session revoked",
  );
  const second = await authorize("second@radius.example");
  assert.equal(
    (await call("/native/exchange", second)).response.status,
    401,
    "second identity cannot take over local owner",
  );
  await call("/native/logout", {}, renewed.data.platformSessionToken);
  assert.equal(
    await runtime.services.authenticateBrowserSession(
      renewed.data.platformSessionToken,
    ),
    null,
    "sign-out revokes Platform session",
  );
  assert.equal(
    (await call("/native/exchange", input)).response.status,
    401,
    "authorization code is single-use",
  );
  const unrelatedUrl = new URL(`${issuer}/oauth2/authorize`);
  Object.entries({
    client_id: unrelatedClient.clientId,
    redirect_uri: unrelatedClient.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: randomBytes(32).toString("base64url"),
    code_challenge: randomBytes(32).toString("base64url"),
    code_challenge_method: "S256",
  }).forEach(([key, value]) => unrelatedUrl.searchParams.set(key, value));
  const unrelated = await call(unrelatedUrl.href);
  assert.equal(
    new URL(unrelated.data.url, origin).pathname,
    "/consent",
    "unrelated clients still require consent",
  );
  console.log(
    "PASS: embedded OTP, signed continuation, consent, native exchange, code replay rejection, refresh, second-owner rejection, logout",
  );
} finally {
  server?.stop(true);
  await runtime?.close();
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
}
