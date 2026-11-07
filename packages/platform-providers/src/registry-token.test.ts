import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createPrivateKey, verify, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodeTest from "node:test";

import {
  REGISTRY_TOKEN_ISSUER,
  createRegistryTokenSigner,
} from "./registry-token.js";

// These tests make key pairs with openssl, as operators do. Git Bash and CI
// have it; a plain Windows shell may not, and then they are reported skipped.
const opensslMissing = spawnSync("openssl", ["version"]).error
  ? "openssl is not on PATH"
  : false;
const test = (name: string, fn: () => void | Promise<void>) =>
  nodeTest(name, { skip: opensslMissing }, fn);

// The same command operators run, so the test covers real openssl output.
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

function decode(token: string) {
  const [header, claims, signature] = token.split(".");
  return {
    header: JSON.parse(Buffer.from(header!, "base64url").toString()),
    claims: JSON.parse(Buffer.from(claims!, "base64url").toString()),
    signed: `${header}.${claims}`,
    signature: Buffer.from(signature!, "base64url"),
  };
}

const first = (opensslMissing ? undefined : keyPair())!;
const second = (opensslMissing ? undefined : keyPair())!;
const uploadId = "0b6f3c1e-8a1f-4a43-9a7e-2f9c1d4b5e6a";

test("signs an ES256 token the certificate in its x5c header verifies", () => {
  const signer = createRegistryTokenSigner(first);
  const now = new Date("2026-11-04T12:00:00.000Z");
  const access = [
    { type: "repository" as const, name: "agent_x/agent", actions: ["pull"] },
  ];
  const signed = signer.sign({
    subject: "upload-1",
    audience: "registry.example.com",
    access,
    now,
  });
  const { header, claims, signed: data, signature } = decode(signed.token);

  assert.equal(header.alg, "ES256");
  const certificate = new X509Certificate(Buffer.from(header.x5c[0], "base64"));
  assert.equal(
    verify(
      "sha256",
      Buffer.from(data),
      {
        key: certificate.publicKey,
        dsaEncoding: "ieee-p1363",
      },
      signature,
    ),
    true,
  );
  assert.equal(claims.iss, REGISTRY_TOKEN_ISSUER);
  assert.equal(claims.sub, "upload-1");
  assert.equal(claims.aud, "registry.example.com");
  assert.deepEqual(claims.access, access);
  assert.equal(claims.exp - claims.iat, 300);
  assert.equal(claims.nbf, claims.iat);
  assert.ok(claims.jti);
  assert.equal(signed.expiresIn, 300);
  assert.equal(signed.issuedAt, now.toISOString());
});

test("never signs a token that outlives notAfter", () => {
  const signer = createRegistryTokenSigner(first);
  const now = new Date("2026-11-04T12:00:00.000Z");
  const signed = signer.sign({
    subject: "upload-1",
    audience: "registry.example.com",
    access: [],
    now,
    notAfter: new Date(now.getTime() + 90_000),
  });
  assert.equal(
    decode(signed.token).claims.exp - decode(signed.token).claims.iat,
    90,
  );
  assert.equal(signed.expiresIn, 90);
});

test("upload passwords are stable per upload and differ between uploads", () => {
  const signer = createRegistryTokenSigner(first);
  const password = signer.uploadPassword(uploadId);
  assert.equal(password, signer.uploadPassword(uploadId));
  assert.notEqual(password, signer.uploadPassword("another-upload"));
  assert.equal(signer.matchesUploadPassword(uploadId, password), true);
  assert.equal(signer.matchesUploadPassword(uploadId, `${password}x`), false);
  assert.equal(signer.matchesUploadPassword("another-upload", password), false);
});

test("the same key in another PEM layout gives the same password", () => {
  const sec1 = createPrivateKey(first.keyPem)
    .export({ format: "pem", type: "sec1" })
    .toString();
  assert.match(sec1, /BEGIN EC PRIVATE KEY/);
  assert.equal(
    createRegistryTokenSigner({ ...first, keyPem: sec1 }).uploadPassword(
      uploadId,
    ),
    createRegistryTokenSigner(first).uploadPassword(uploadId),
  );
});

test("during rotation, passwords from the old key still match", () => {
  const before = createRegistryTokenSigner(first);
  const rotating = createRegistryTokenSigner({
    keyPem: `${second.keyPem}\n${first.keyPem}`,
    certificatePem: `${second.certificatePem}\n${first.certificatePem}`,
  });
  const oldPassword = before.uploadPassword(uploadId);
  assert.equal(rotating.matchesUploadPassword(uploadId, oldPassword), true);
  assert.notEqual(rotating.uploadPassword(uploadId), oldPassword);
  const header = decode(
    rotating.sign({ subject: "s", audience: "a", access: [] }).token,
  ).header;
  assert.equal(
    header.x5c[0],
    new X509Certificate(second.certificatePem).raw.toString("base64"),
  );
});

test("refuses a certificate that does not match the first key", () => {
  assert.throws(
    () =>
      createRegistryTokenSigner({
        keyPem: first.keyPem,
        certificatePem: second.certificatePem,
      }),
    /does not match/,
  );
});
