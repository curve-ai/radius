import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeEntriesFromEnvironment } from "./native-auth.js";
import {
  authMode,
  embeddedAuthSecret,
  embeddedAuthUrl,
} from "./embedded-auth-config.js";
import { ensureDevelopmentAuthSecret } from "./development-auth-secret.js";

const local = {
  RADIUS_LOCAL_DEVELOPMENT: "true",
  NODE_ENV: "development",
  HOST: "127.0.0.1",
  DATABASE_URL:
    "postgresql://radius:password@127.0.0.1:5442/radius_development",
  RADIUS_OIDC_ALLOW_INSECURE_LOOPBACK: "true",
};

test("local development supplies an embedded native client, not a Cloud dependency", () => {
  const [entry] = nativeEntriesFromEnvironment(local);
  assert.equal(entry.config.issuer, "http://localhost:3100/api/auth");
  assert.equal(
    entry.config.resource,
    "http://localhost:3100/radius-development",
  );
  assert.equal(entry.config.organizationSlug, "dev");
  assert.ok(entry.config.scopes.includes("offline_access"));
});
test("external mode retains hosted fallback and explicit issuer configuration", () => {
  const [hosted] = nativeEntriesFromEnvironment({
    ...local,
    RADIUS_AUTH_MODE: "external",
  });
  assert.equal(hosted.config.issuer, "https://app.curvehq.sh/api/auth");
  const [external] = nativeEntriesFromEnvironment({
    ...local,
    RADIUS_AUTH_MODE: "external",
    RADIUS_AUTH_ISSUER: "https://identity.example.com/auth",
  });
  assert.equal(external.config.issuer, "https://identity.example.com/auth");
  assert.throws(() => authMode({ RADIUS_AUTH_MODE: "typo" }));
  assert.throws(() =>
    embeddedAuthUrl({
      ...local,
      RADIUS_AUTH_URL: "http://remote.example.com/api/auth",
    }),
  );
  assert.throws(() => embeddedAuthSecret({ BETTER_AUTH_SECRET: "short" }));
});
test(
  "development signing secret is private and stable across restarts",
  { skip: process.platform === "win32" },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "radius-auth-secret-"));
    try {
      const first: NodeJS.ProcessEnv = {
        ...local,
        RADIUS_LOCAL_STATE_DIR: directory,
      };
      ensureDevelopmentAuthSecret(first);
      const second: NodeJS.ProcessEnv = {
        ...local,
        RADIUS_LOCAL_STATE_DIR: directory,
      };
      ensureDevelopmentAuthSecret(second);
      assert.equal(first.BETTER_AUTH_SECRET, second.BETTER_AUTH_SECRET);
      assert.equal(
        statSync(join(directory, "auth-secret")).mode & 0o777,
        0o600,
      );
      assert.equal(
        readFileSync(join(directory, "auth-secret"), "utf8"),
        first.BETTER_AUTH_SECRET,
      );
      assert.throws(() =>
        ensureDevelopmentAuthSecret({
          ...local,
          NODE_ENV: "production",
          RADIUS_LOCAL_STATE_DIR: directory,
        }),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
