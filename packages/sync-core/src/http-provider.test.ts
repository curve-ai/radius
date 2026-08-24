import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";

import { HttpSyncProvider } from "./http-provider.js";

test("signs push requests with the client-instance key", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const clientInstanceId = "19353755-3c5e-4529-b58d-c74dacf7b68d";
  let verified = false;

  const provider = new HttpSyncProvider({
    endpoint: "https://sync.example.test/api/sync/v1/",
    identity: {
      clientInstanceId,
      displayName: "Test Mac",
      platform: "darwin",
      publicKeyJwk: publicKey.export({ format: "jwk" }),
      privateKeyJwk: privateKey.export({ format: "jwk" }),
      appVersion: "0.0.1",
    },
    getAccessToken: async () => "test-token",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const body = await request.text();
      const timestamp = request.headers.get("x-radius-timestamp")!;
      const signature = request.headers.get("x-radius-signature")!;
      const url = new URL(request.url);
      const bodyHash = createHash("sha256").update(body).digest("hex");
      verified = verify(
        null,
        Buffer.from(
          `${request.method}\n${url.pathname}${url.search}\n${timestamp}\n${bodyHash}`,
        ),
        publicKey,
        Buffer.from(signature, "base64url"),
      );
      assert.equal(request.headers.get("authorization"), "Bearer test-token");
      assert.equal(
        request.headers.get("x-radius-client-instance-id"),
        clientInstanceId,
      );
      return Response.json({
        protocolVersion: 1,
        results: [],
      });
    },
  });

  await provider.push({
    protocolVersion: 1,
    clientInstanceId,
    changes: [],
  });
  assert.equal(verified, true);
});
