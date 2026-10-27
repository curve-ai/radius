import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { nativeBrowserLogin } from "./native-login";

async function port(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const value = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return value;
}

test("browser return ignores unrelated requests and captures exactly its PKCE attempt", async () => {
  const redirectUri = `http://127.0.0.1:${await port()}/callback`;
  let browserUrl: URL | undefined;
  const result = await nativeBrowserLogin(
    {
      issuer: "https://id.example.com",
      authorizationEndpoint: "https://id.example.com/authorize",
      clientId: "desktop",
      redirectUri,
      scopes: ["openid"],
      resource: "https://api.example.com",
      organizationSlug: "example",
      displayName: "Example",
      agentId: "agent",
    },
    async (url) => {
      browserUrl = new URL(url);
      assert.equal(
        (await fetch(`${redirectUri}?code=wrong&state=wrong`)).status,
        400,
      );
      assert.equal(
        (
          await fetch(
            `${redirectUri}?code=ok&state=${browserUrl.searchParams.get("state")}`,
          )
        ).status,
        200,
      );
    },
    new AbortController().signal,
  );
  assert.equal(new URL(result.callbackUrl).searchParams.get("code"), "ok");
  assert.equal(result.state, browserUrl!.searchParams.get("state"));
  assert.equal(result.nonce, browserUrl!.searchParams.get("nonce"));
  assert.equal(browserUrl!.searchParams.get("code_challenge_method"), "S256");
  assert.ok(!browserUrl!.href.includes(result.codeVerifier));
});

test("cancel closes the listener and rejects without waiting for callback", async () => {
  const redirectUri = `http://127.0.0.1:${await port()}/callback`;
  const controller = new AbortController();
  await assert.rejects(
    nativeBrowserLogin(
      {
        issuer: "https://id.example.com",
        authorizationEndpoint: "https://id.example.com/authorize",
        clientId: "desktop",
        redirectUri,
        scopes: ["openid"],
        resource: "https://api.example.com",
        organizationSlug: "example",
        displayName: "Example",
        agentId: "agent",
      },
      async () => controller.abort(),
      controller.signal,
    ),
    /AUTH_CANCELLED/,
  );
});
