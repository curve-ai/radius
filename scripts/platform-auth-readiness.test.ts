import assert from "node:assert/strict";
import test from "node:test";
import { checkPlatformAuth } from "./platform-auth-readiness.js";

test("a healthy unrelated server does not pass desktop auth readiness", async () => {
  await assert.rejects(
    checkPlatformAuth(
      "http://localhost:3100",
      async () => new Response("Not found", { status: 404 }),
    ),
    /does not serve/,
  );
  await assert.rejects(
    checkPlatformAuth("http://localhost:3100", async () =>
      Response.json({ status: "healthy" }),
    ),
    /./,
  );
});
test("unconfigured auth produces configuration guidance", async () => {
  await assert.rejects(
    checkPlatformAuth(
      "http://localhost:3100",
      async () => new Response(null, { status: 503 }),
    ),
    /registered OAuth client/,
  );
});
test("configured native auth passes without launching a browser", async () => {
  await checkPlatformAuth("https://platform.example.com/base/", async (url) => {
    assert.equal(
      String(url),
      "https://platform.example.com/base/api/platform/v1/auth/native/config",
    );
    return Response.json({
      issuer: "https://id.example.com",
      authorizationEndpoint: "https://id.example.com/authorize",
      clientId: "native-client",
      organizationSlug: "example",
      agentId: "agent",
      displayName: "Example",
      resource: "https://api.example.com",
      redirectUri: "http://127.0.0.1:43821/callback",
      scopes: ["openid"],
    });
  });
});
