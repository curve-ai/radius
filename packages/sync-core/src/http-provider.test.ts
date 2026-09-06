import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";

import { HttpSyncProvider } from "./http-provider.js";

test("signs push requests with the client-instance key", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const clientInstanceId = "19353755-3c5e-4529-b58d-c74dacf7b68d";
  let verified = false;

  const provider = new HttpSyncProvider({
    endpoint: "https://northwind.curvehq.sh/api/platform/v1/sync/",
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

function identityFor(clientInstanceId: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    clientInstanceId,
    displayName: "Test Mac",
    platform: "darwin",
    publicKeyJwk: publicKey.export({ format: "jwk" }),
    privateKeyJwk: privateKey.export({ format: "jwk" }),
    appVersion: "0.0.1",
  };
}

test("registers with a fresh identity after the device was revoked", async () => {
  const revoked = identityFor("6b1f9f52-1f0a-4c1e-9a2a-6f7c8d9e0a1b");
  const replacement = identityFor("f0e1d2c3-b4a5-4968-8776-554433221100");
  const registered: string[] = [];
  let rotations = 0;

  const provider = new HttpSyncProvider({
    endpoint: "https://northwind.curvehq.sh/api/platform/v1/sync/",
    identity: revoked,
    rotateIdentity: async () => {
      rotations += 1;
      return replacement;
    },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const body = (await request.json()) as { clientInstanceId: string };
      registered.push(body.clientInstanceId);
      // Revocation is final, so the server keeps refusing the old id.
      return body.clientInstanceId === revoked.clientInstanceId
        ? Response.json({ error: "DEVICE_REVOKED" }, { status: 409 })
        : Response.json({ deviceId: body.clientInstanceId, registered: true });
    },
  });

  await provider.registerDevice();

  assert.equal(rotations, 1);
  assert.deepEqual(registered, [
    revoked.clientInstanceId,
    replacement.clientInstanceId,
  ]);
  // Pushes name the device that produced them, so the caller must follow the
  // rotation rather than keep using the id it started with.
  assert.equal(provider.clientInstanceId, replacement.clientInstanceId);
});

test("does not rotate when another device already claimed the id", async () => {
  const identity = identityFor("2c9a7f10-3d5b-4e6f-8a9b-0c1d2e3f4a5b");
  let rotations = 0;

  const provider = new HttpSyncProvider({
    endpoint: "https://northwind.curvehq.sh/api/platform/v1/sync/",
    identity,
    rotateIdentity: async () => {
      rotations += 1;
      return identityFor("00000000-0000-4000-8000-000000000000");
    },
    fetch: async () =>
      Response.json({ error: "DEVICE_IDENTITY_CONFLICT" }, { status: 409 }),
  });

  await assert.rejects(
    () => provider.registerDevice(),
    /DEVICE_IDENTITY_CONFLICT/,
  );
  assert.equal(rotations, 0);
});

test("sends no authorization header when the fetch carries the session", async () => {
  const identity = identityFor("8d7c6b5a-4938-4271-a605-f4e3d2c1b0a9");
  let sawAuthorization: string | null = "unset";

  const provider = new HttpSyncProvider({
    endpoint: "https://northwind.curvehq.sh/api/platform/v1/sync/",
    identity,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      sawAuthorization = request.headers.get("authorization");
      return Response.json({
        protocolVersions: [1],
        maxBatchSize: 100,
        artifactTransfer: true,
      });
    },
  });

  await provider.capabilities();
  assert.equal(sawAuthorization, null);
});
