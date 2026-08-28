import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import test from "node:test";

import { exportJWK, generateKeyPair, SignJWT } from "jose";

import {
  generateOidcTransactionSecret,
  normalizePlatformOidcOptions,
  PlatformOidcClient,
} from "./oidc.js";
import { readCookie } from "./cookies.js";

test("completes discovery, PKCE, state, nonce, and signed ID-token validation", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: "radius-test", use: "sig", alg: "RS256" });
  let issuer = "";
  let expectedChallenge = "";
  let expectedNonce = "";
  let providerError = "";
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/.well-known/openid-configuration") {
        return json(response, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
          code_challenge_methods_supported: ["S256"],
        });
      }
      if (request.url === "/jwks") return json(response, { keys: [jwk] });
      if (request.url === "/token" && request.method === "POST") {
        assert.equal(
          request.headers.authorization,
          `Basic ${Buffer.from("radius%2Dclient:radius%2Dsecret").toString("base64")}`,
        );
        const body = new URLSearchParams(await requestBody(request));
        assert.equal(body.get("code"), "authorization-code");
        assert.equal(
          createHash("sha256")
            .update(body.get("code_verifier") ?? "")
            .digest("base64url"),
          expectedChallenge,
        );
        const now = Math.floor(Date.now() / 1000);
        const idToken = await new SignJWT({
          email: "owner@example.com",
          email_verified: true,
          name: "OIDC Owner",
          nonce: expectedNonce,
        })
          .setProtectedHeader({ alg: "RS256", kid: "radius-test" })
          .setIssuer(issuer)
          .setAudience("radius-client")
          .setSubject("oidc-subject")
          .setIssuedAt(now)
          .setExpirationTime(now + 300)
          .sign(privateKey);
        return json(response, {
          access_token: "provider-access-token",
          token_type: "Bearer",
          expires_in: 300,
          id_token: idToken,
        });
      }
      response.writeHead(404).end();
    } catch (error) {
      providerError =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      response.writeHead(500).end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    issuer = `http://127.0.0.1:${address.port}`;
    const client = new PlatformOidcClient(
      normalizePlatformOidcOptions({
        issuer,
        clientId: "radius-client",
        clientSecret: "radius-secret",
        redirectUri: "http://127.0.0.1:3110/api/platform/v1/auth/oidc/callback",
        transactionSecret: generateOidcTransactionSecret(),
        allowInsecureLoopback: true,
      }),
    );
    const started = await client.begin("/workspace/agents");
    expectedChallenge =
      started.authorizationUrl.searchParams.get("code_challenge") ?? "";
    expectedNonce = started.authorizationUrl.searchParams.get("nonce") ?? "";
    const sealed = readCookie(started.setCookie, "radius_oidc_transaction");
    assert.ok(sealed);
    const callback = new URL(
      "http://127.0.0.1:3110/api/platform/v1/auth/oidc/callback",
    );
    callback.searchParams.set("code", "authorization-code");
    callback.searchParams.set("state", started.transaction.state);
    let completed;
    try {
      completed = await client.complete(callback, sealed);
    } catch (error) {
      assert.fail(`${String(error)}\nProvider error: ${providerError}`);
    }
    assert.deepEqual(completed.claims, {
      issuer,
      subject: "oidc-subject",
      email: "owner@example.com",
      emailVerified: true,
      displayName: "OIDC Owner",
    });
    assert.equal(completed.returnTo, "/workspace/agents");

    const second = await client.begin();
    const secondCookie = readCookie(
      second.setCookie,
      "radius_oidc_transaction",
    );
    assert.ok(secondCookie);
    const wrongState = new URL(callback);
    wrongState.searchParams.set("state", "wrong-state");
    await assert.rejects(client.complete(wrongState, secondCookie));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

function json(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function requestBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body;
}
