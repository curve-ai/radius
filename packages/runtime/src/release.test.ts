import assert from "node:assert/strict";
import test from "node:test";

import {
  immutableImageReference,
  parseAgentReleaseDescriptor,
} from "./release.js";

const digest = `sha256:${"a".repeat(64)}`;

const descriptor = {
  schemaVersion: 1,
  agentId: "example-agent",
  providerId: "example-provider",
  displayName: "Example Agent",
  releaseVersion: "1.0.0",
  protocol: { kind: "acp-stdio", version: 1 },
  image: {
    reference: "registry.example/agent",
    digest,
    platform: "linux/amd64",
    translation: "rosetta",
  },
  process: {
    arguments: ["/agent/start"],
    user: "10000:10000",
    statePath: "/opt/data",
  },
  resources: {
    cpus: 2,
    memoryMb: 4096,
    rootfsMb: 2048,
    stateMb: 5120,
    processLimit: 256,
    openFileLimit: 1024,
  },
  networkAllowlist: ["api.example"],
  capabilities: ["example.read"],
};

test("accepts a digest-pinned translated amd64 release", () => {
  const release = parseAgentReleaseDescriptor(descriptor);
  assert.equal(
    immutableImageReference(release),
    `registry.example/agent@${digest}`,
  );
});

test("rejects amd64 without explicit Rosetta", () => {
  assert.throws(() =>
    parseAgentReleaseDescriptor({
      ...descriptor,
      image: { ...descriptor.image, translation: "none" },
    }),
  );
});

test("requires a declared default model", () => {
  assert.throws(() =>
    parseAgentReleaseDescriptor({
      ...descriptor,
      defaultModelId: "codex/deep",
      models: [{ id: "codex/fast", label: "Codex Fast" }],
    }),
  );
});

test("accepts one normalized device-local authentication requirement", () => {
  const release = parseAgentReleaseDescriptor({
    ...descriptor,
    authRequirements: [
      {
        key: "codex-subscription",
        authority: {
          key: "openai-codex",
          purpose: "model_provider",
          issuer: "https://auth.openai.com",
          displayName: "Codex",
        },
        flow: {
          key: "subscription-oauth",
          kind: "provider_native_oauth",
          publicClientId: null,
          audience: "https://chatgpt.com/backend-api/codex",
          deviceBindingSupported: false,
        },
        requirement: "required",
        portability: "device_only",
        runtimeDelivery: "agent_state_adapter",
        custodyKinds: ["encrypted_agent_state"],
        scopes: [],
      },
    ],
  });
  assert.equal(release.authRequirements[0]?.key, "codex-subscription");
});
