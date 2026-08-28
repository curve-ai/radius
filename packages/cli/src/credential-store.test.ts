import assert from "node:assert/strict";
import test from "node:test";

import {
  credentialAccount,
  resolvePlatformAccessToken,
  type RadiusCredentialStore,
} from "./credential-store.js";

const target = { name: "self-hosted", apiUrl: "https://platform.example.com" };

test("uses stable non-secret keyring account identities", () => {
  const account = credentialAccount(target);
  assert.match(account, /^profile:self-hosted:[a-f0-9]{16}$/);
  assert.doesNotMatch(account, /platform\.example\.com/);
});

test("prefers explicit and environment credentials before the keyring", async () => {
  let reads = 0;
  const store: RadiusCredentialStore = {
    get: async () => {
      reads += 1;
      return "stored";
    },
    set: async () => undefined,
    delete: async () => false,
  };
  const previous = process.env.RADIUS_ACCESS_TOKEN;
  try {
    process.env.RADIUS_ACCESS_TOKEN = "environment";
    assert.equal(await resolvePlatformAccessToken(target, "explicit", store), "explicit");
    assert.equal(await resolvePlatformAccessToken(target, undefined, store), "environment");
    delete process.env.RADIUS_ACCESS_TOKEN;
    assert.equal(await resolvePlatformAccessToken(target, undefined, store), "stored");
    assert.equal(reads, 1);
  } finally {
    if (previous === undefined) delete process.env.RADIUS_ACCESS_TOKEN;
    else process.env.RADIUS_ACCESS_TOKEN = previous;
  }
});
