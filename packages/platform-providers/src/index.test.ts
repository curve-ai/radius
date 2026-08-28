import assert from "node:assert/strict";
import test from "node:test";

import {
  RegistryVerificationError,
  createDistributionRegistryVerifier,
} from "./index.js";

const digest =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

test("verifies an allowlisted manifest by exact digest", async () => {
  let requestedUrl = "";
  const verifier = createDistributionRegistryVerifier({
    allowedRegistries: ["registry.example.com"],
    authorizationForRegistry: () => "Bearer worker-token",
    fetch: async (input, init) => {
      requestedUrl = String(input);
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer worker-token");
      return new Response(null, {
        status: 200,
        headers: {
          "content-type": "application/vnd.oci.image.manifest.v1+json",
          "content-length": "712",
          "docker-content-digest": digest,
        },
      });
    },
  });

  const result = await verifier.verifyManifest({
    imageReference: "registry.example.com/radius/agent:release-1",
    expectedDigest: digest,
  });

  assert.equal(
    requestedUrl,
    `https://registry.example.com/v2/radius/agent/manifests/${digest}`,
  );
  assert.equal(result.digest, digest);
  assert.equal(result.contentLength, 712);
});

test("rejects a registry outside the worker allowlist before fetching", async () => {
  const verifier = createDistributionRegistryVerifier({
    allowedRegistries: ["registry.example.com"],
    fetch: async () => {
      throw new Error("fetch should not run");
    },
  });

  await assert.rejects(
    verifier.verifyManifest({
      imageReference: "attacker.example/agent:latest",
      expectedDigest: digest,
    }),
    (error) =>
      error instanceof RegistryVerificationError &&
      error.code === "REGISTRY_NOT_ALLOWED",
  );
});

test("requires explicit opt-in before using a loopback HTTP registry", async () => {
  const verifier = createDistributionRegistryVerifier({
    allowedRegistries: ["127.0.0.1:5001"],
    fetch: async () => new Response(null, { status: 200 }),
  });

  await assert.rejects(
    verifier.verifyManifest({
      imageReference: "127.0.0.1:5001/radius/agent:latest",
      expectedDigest: digest,
    }),
    (error) =>
      error instanceof RegistryVerificationError &&
      error.code === "REGISTRY_NOT_ALLOWED",
  );
});

test("allows an explicitly configured internal HTTP registry", async () => {
  let requestedUrl = "";
  const verifier = createDistributionRegistryVerifier({
    allowedRegistries: ["registry:5000"],
    insecureRegistries: ["registry:5000"],
    fetch: async (input) => {
      requestedUrl = String(input);
      return new Response(null, {
        status: 200,
        headers: { "docker-content-digest": digest },
      });
    },
  });

  await verifier.verifyManifest({
    imageReference: "registry:5000/radius/agent:release",
    expectedDigest: digest,
  });
  assert.match(requestedUrl, /^http:\/\/registry:5000\/v2\//);
});

test("maps a public registry authority to its internal endpoint", async () => {
  let requestedUrl = "";
  const verifier = createDistributionRegistryVerifier({
    allowedRegistries: ["127.0.0.1:5001"],
    allowInsecureLoopback: true,
    insecureRegistries: ["registry:5000"],
    registryEndpoints: { "127.0.0.1:5001": "registry:5000" },
    fetch: async (input) => {
      requestedUrl = String(input);
      return new Response(null, {
        status: 200,
        headers: { "docker-content-digest": digest },
      });
    },
  });

  await verifier.verifyManifest({
    imageReference: "127.0.0.1:5001/radius/agent:release",
    expectedDigest: digest,
  });
  assert.match(requestedUrl, /^http:\/\/registry:5000\/v2\//);
});
