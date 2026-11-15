import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodeTest from "node:test";

import { createRegistryTokenSigner } from "@curve-ai/platform-providers";
import { decodeJwt, decodeProtectedHeader, importX509, jwtVerify } from "jose";

import { createPlatformApp, type RadiusPlatformServices } from "./app.js";
import {
  createRegistryTokenRoutes,
  repositoryOf,
  type RegistryUploadRecord,
} from "./registry-token.js";

// These tests make key pairs with openssl, as operators do. Git Bash and CI
// have it; a plain Windows shell may not, and then they are reported skipped.
const opensslMissing = spawnSync("openssl", ["version"]).error
  ? "openssl is not on PATH"
  : false;
const test = (name: string, fn: () => void | Promise<void>) =>
  nodeTest(name, { skip: opensslMissing }, fn);

function keyPair(): { keyPem: string; certificatePem: string } {
  const directory = mkdtempSync(join(tmpdir(), "radius-registry-token-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:P-256",
        "-nodes",
        "-keyout",
        join(directory, "token.key"),
        "-out",
        join(directory, "token.crt"),
        "-days",
        "1",
        "-subj",
        "/CN=radius-registry-token-test",
      ],
      { stdio: "ignore" },
    );
    return {
      keyPem: readFileSync(join(directory, "token.key"), "utf8"),
      certificatePem: readFileSync(join(directory, "token.crt"), "utf8"),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const signer = opensslMissing
  ? (undefined as never)
  : createRegistryTokenSigner(keyPair());
const service = "registry.example.com";
const uploadId = "0b6f3c1e-8a1f-4a43-9a7e-2f9c1d4b5e6a";
const username = `upload-${uploadId}`;
const password = opensslMissing ? "" : signer.uploadPassword(uploadId);
const now = new Date("2026-11-04T12:00:00.000Z");
const repository = "agent_x/agent";

function upload(overrides: Partial<RegistryUploadRecord> = {}) {
  return {
    state: "prepared",
    expiresAt: new Date(now.getTime() + 60 * 60_000),
    imageReference: `${service}/${repository}:0b6f3c1e8a1f4a439a7e2f9c1d4b5e6a`,
    ...overrides,
  };
}

// Mounted through the real app, so the test also proves the route is reached
// without the Bearer-token check in front of it.
function platform(record: RegistryUploadRecord | null = upload()) {
  return createPlatformApp({} as RadiusPlatformServices, {
    registryToken: createRegistryTokenRoutes({
      signer,
      service,
      findUpload: async (id) => (id === uploadId ? record : null),
      now: () => now,
    }),
  });
}

function tokenRequest(
  scopes: string[],
  credentials: { user: string; pass: string } | null = {
    user: username,
    pass: password,
  },
  serviceName = service,
) {
  const query = new URLSearchParams({ service: serviceName });
  for (const scope of scopes) query.append("scope", scope);
  return new Request(
    `http://platform.test/api/platform/v1/registry/token?${query}`,
    {
      headers: credentials
        ? {
            authorization: `Basic ${Buffer.from(`${credentials.user}:${credentials.pass}`).toString("base64")}`,
          }
        : {},
    },
  );
}

async function access(response: Response) {
  assert.equal(response.status, 200);
  const body = (await response.json()) as Record<string, unknown>;
  return { body, claims: decodeJwt(body.token as string) };
}

test("grants push and pull on the upload's own repository", async () => {
  const response = await platform().request(
    tokenRequest([`repository:${repository}:push,pull`]),
  );
  const { body, claims } = await access(response);
  assert.deepEqual(claims.access, [
    { type: "repository", name: repository, actions: ["push", "pull"] },
  ]);
  assert.equal(claims.sub, username);
  assert.equal(claims.aud, service);
  assert.equal(body.access_token, body.token);
  assert.equal(body.expires_in, 300);
  assert.equal("refresh_token" in body, false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("the token verifies against the certificate in its header", async () => {
  const { body } = await access(
    await platform().request(tokenRequest([`repository:${repository}:pull`])),
  );
  const token = body.token as string;
  const certificate = decodeProtectedHeader(token).x5c![0]!;
  const key = await importX509(
    `-----BEGIN CERTIFICATE-----\n${certificate}\n-----END CERTIFICATE-----`,
    "ES256",
  );
  const verified = await jwtVerify(token, key, {
    issuer: "radius-platform",
    audience: service,
    currentDate: now,
  });
  assert.equal(verified.payload.sub, username);
});

test("docker login without a scope gets a token with no access", async () => {
  const { claims } = await access(await platform().request(tokenRequest([])));
  assert.deepEqual(claims.access, []);
});

test("drops scopes for other repositories and other actions", async () => {
  const { claims } = await access(
    await platform().request(
      tokenRequest([
        "repository:agent_other/agent:push,pull",
        `repository:${repository}:pull,delete`,
        "registry:catalog:*",
      ]),
    ),
  );
  assert.deepEqual(claims.access, [
    { type: "repository", name: repository, actions: ["pull"] },
  ]);
});

test("a token never outlives its upload", async () => {
  const { claims, body } = await access(
    await platform(
      upload({ expiresAt: new Date(now.getTime() + 60_000) }),
    ).request(tokenRequest([`repository:${repository}:push`])),
  );
  assert.equal(claims.exp! - claims.iat!, 60);
  assert.equal(body.expires_in, 60);
});

test("refuses a wrong password, an unknown upload or a missing login", async () => {
  for (const request of [
    tokenRequest([], { user: username, pass: `${password}x` }),
    tokenRequest([], {
      user: "upload-11111111-1111-4111-8111-111111111111",
      pass: password,
    }),
    tokenRequest([], { user: "radius", pass: "static-password" }),
    tokenRequest([], null),
  ]) {
    const response = await platform().request(request);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate") ?? "", /^Basic /);
  }
});

test("refuses an expired or failed upload", async () => {
  for (const record of [
    upload({ expiresAt: now }),
    upload({ state: "finalized", expiresAt: now }),
    upload({ state: "expired" }),
    upload({ state: "failed" }),
  ]) {
    const response = await platform(record).request(tokenRequest([]));
    assert.equal(response.status, 401);
  }
});

test("a finalized upload works until it expires, so a re-run push succeeds", async () => {
  const { claims } = await access(
    await platform(upload({ state: "finalized" })).request(
      tokenRequest([`repository:${repository}:push,pull`]),
    ),
  );
  assert.deepEqual(claims.access, [
    { type: "repository", name: repository, actions: ["push", "pull"] },
  ]);
});

test("refuses a token for another registry service", async () => {
  const response = await platform().request(
    tokenRequest([], undefined, "registry.attacker.example"),
  );
  assert.equal(response.status, 400);
});

test("without the signer configured, the route is behind normal auth", async () => {
  const response = await createPlatformApp(
    {} as RadiusPlatformServices,
  ).request(tokenRequest([]));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("www-authenticate"), null);
});

test("finds the repository in an image reference", () => {
  assert.equal(
    repositoryOf("127.0.0.1:5001/agent_x/agent:abc"),
    "agent_x/agent",
  );
  assert.equal(repositoryOf("registry.example.com/a/b"), "a/b");
});
