import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RadiusCredentialStore } from "./credential-store.js";
import { loginToRadius, logoutFromRadius } from "./login.js";
import { RadiusProfileStore } from "./profiles.js";

test("validates a token before storing it and keeps profiles non-secret", async () => {
  const root = await mkdtemp(join(tmpdir(), "radius-login-"));
  const profiles = new RadiusProfileStore(join(root, "profiles.json"));
  let stored: string | null = null;
  const credentials: RadiusCredentialStore = {
    get: async () => stored,
    set: async (_target, token) => {
      stored = token;
    },
    delete: async () => {
      const existed = stored !== null;
      stored = null;
      return existed;
    },
  };
  const output: string[] = [];
  const identity = await loginToRadius({
    profile: "local",
    apiUrl: "http://127.0.0.1:3110",
    token: "one-time-secret",
    profileStore: profiles,
    credentialStore: credentials,
    fetch: async (_input, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer one-time-secret");
      return Response.json({
        apiVersion: 1,
        accountId: "11111111-1111-4111-8111-111111111111",
        organizations: [],
      });
    },
    io: { out: (message) => output.push(message), error: () => undefined },
  });
  assert.equal(identity.accountId, "11111111-1111-4111-8111-111111111111");
  assert.equal(stored, "one-time-secret");
  assert.doesNotMatch(await readFile(profiles.path, "utf8"), /one-time-secret/);
  assert.equal(
    await logoutFromRadius({
      profile: "local",
      profileStore: profiles,
      credentialStore: credentials,
      io: { out: (message) => output.push(message), error: () => undefined },
    }),
    true,
  );
  assert.equal(stored, null);
});

test("does not store a token rejected by the Platform", async () => {
  const root = await mkdtemp(join(tmpdir(), "radius-login-rejected-"));
  const profiles = new RadiusProfileStore(join(root, "profiles.json"));
  let writes = 0;
  const credentials: RadiusCredentialStore = {
    get: async () => null,
    set: async () => {
      writes += 1;
    },
    delete: async () => false,
  };
  await assert.rejects(
    loginToRadius({
      profile: "local",
      apiUrl: "http://127.0.0.1:3110",
      token: "rejected",
      profileStore: profiles,
      credentialStore: credentials,
      fetch: async () =>
        Response.json(
          {
            apiVersion: 1,
            error: { code: "UNAUTHORIZED", message: "Invalid", requestId: null },
          },
          { status: 401 },
        ),
      io: { out: () => undefined, error: () => undefined },
    }),
    /Invalid/,
  );
  assert.equal(writes, 0);
});
