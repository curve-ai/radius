import assert from "node:assert/strict";
import test from "node:test";

import type { CredentialVault } from "./credential-vault";
import {
  mcpCredentialReference,
  VaultMcpOAuthProvider,
} from "./mcp-connector-auth";

function memoryVault(): CredentialVault {
  const values = new Map<string, string>();
  return {
    clientInstanceId: "test-client",
    publicKeyJwk: {},
    databaseKey: "test-key",
    privateKeyJwk: {},
    async getSecret(reference) {
      return values.get(reference) ?? null;
    },
    async setSecret(reference, value) {
      values.set(reference, value);
    },
    async deleteSecret(reference) {
      return values.delete(reference);
    },
  };
}

test("persists MCP OAuth client and token state in one vault reference", async () => {
  const vault = memoryVault();
  const credentialRef = mcpCredentialReference("installation-1");
  const provider = new VaultMcpOAuthProvider({
    vault,
    credentialRef,
    redirectUrl: new URL("http://127.0.0.1:4567/oauth/callback"),
    interactive: true,
  });
  await provider.initialize();
  const context = { issuer: "https://auth.example.com" };
  await provider.saveClientInformation(
    {
      client_id: "radius-client",
      redirect_uris: ["http://127.0.0.1:4567/oauth/callback"],
    },
    context,
  );
  await provider.saveTokens(
    {
      access_token: "secret-token",
      token_type: "Bearer",
    },
    context,
  );
  assert.equal(provider.hasTokens(), true);

  const restored = new VaultMcpOAuthProvider({
    vault,
    credentialRef,
    interactive: false,
  });
  await restored.initialize();
  assert.equal(restored.clientInformation(context)?.client_id, "radius-client");
  assert.equal(restored.tokens()?.access_token, "secret-token");
});

test("uses a stable installation-scoped credential reference", () => {
  assert.equal(
    mcpCredentialReference("installation-1"),
    "connector:mcp:installation-1",
  );
});
