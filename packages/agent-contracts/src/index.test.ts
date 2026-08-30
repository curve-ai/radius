import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentBuildReceiptSchema,
  AgentConfigSchema,
  AgentManifestSchema,
  RelativeProjectPathSchema,
} from "./index.js";

test("normalizes a TypeScript agent config", () => {
  const config = AgentConfigSchema.parse({
    name: "Research agent",
    runtime: { kind: "typescript", entrypoint: "radius/agent.ts" },
    capabilities: [{ key: "workspace.files", operations: ["read", "write"] }],
  });

  assert.equal(config.schemaVersion, 1);
  assert.equal(config.agent, null);
  assert.equal(config.minimumDesktopVersion, "0.0.1");
  assert.equal(config.runtime.kind, "typescript");
  assert.deepEqual(config.resources, {
    cpu: 2,
    memoryMb: 4096,
    diskMb: 5120,
  });
});

test("accepts a Python ACP runtime without changing the manifest contract", () => {
  const config = AgentConfigSchema.parse({
    name: "Python agent",
    runtime: { kind: "python", module: "my_agent.agent", python: "3.12" },
  });
  assert.deepEqual(config.runtime, {
    kind: "python",
    module: "my_agent.agent",
    python: "3.12",
    lockfile: "uv.lock",
  });
});

test("rejects entrypoints that escape the project root", () => {
  assert.equal(
    RelativeProjectPathSchema.safeParse("../agent.ts").success,
    false,
  );
  assert.equal(
    RelativeProjectPathSchema.safeParse("/tmp/agent.ts").success,
    false,
  );
  assert.equal(
    RelativeProjectPathSchema.safeParse("radius\\agent.ts").success,
    false,
  );
});

test("rejects duplicate capability identities", () => {
  const result = AgentConfigSchema.safeParse({
    name: "Duplicate capabilities",
    runtime: { kind: "command", command: ["agent", "--acp"] },
    capabilities: [
      { key: "workspace.files", operations: ["read"] },
      { key: "workspace.files", operations: ["write"] },
    ],
  });
  assert.equal(result.success, false);
});

test("accepts only loopback WebSocket development endpoints", () => {
  const config = AgentConfigSchema.parse({
    name: "Development agent",
    runtime: { kind: "command", command: ["agent", "--acp"] },
    development: {
      endpoint: "ws://127.0.0.1:7331/acp",
      authorizationEnv: "RADIUS_AGENT_DEV_TOKEN",
    },
  });
  assert.equal(config.development?.endpoint, "ws://127.0.0.1:7331/acp");
  assert.throws(() =>
    AgentConfigSchema.parse({
      name: "Remote development agent",
      runtime: { kind: "command", command: ["agent", "--acp"] },
      development: { endpoint: "wss://agents.example.com/acp" },
    }),
  );
});

test("validates immutable build receipts", () => {
  const manifest = AgentManifestSchema.parse({
    schemaVersion: 1,
    agent: "agent_example1",
    name: "Built agent",
    protocol: { kind: "acp-stdio", version: 1 },
    runtime: { kind: "command", command: ["agent", "--acp"] },
    capabilities: [],
    networkAllowlist: [],
    resources: { cpu: 2, memoryMb: 4096, diskMb: 5120 },
    minimumDesktopVersion: "0.0.1",
  });
  const receipt = AgentBuildReceiptSchema.parse({
    schemaVersion: 1,
    buildDigest: "a".repeat(64),
    imageReference: "radius.local/dev/agent:test",
    sourceManifestDigest: `sha256:${"b".repeat(64)}`,
    bundleSha256: "c".repeat(64),
    layoutPath: `.radius/builds/${"a".repeat(64)}/oci-layout`,
    contextPath: `.radius/builds/${"a".repeat(64)}/context`,
    manifest,
    verifiedAt: "2026-08-29T12:00:00.000Z",
    verification: { kind: "microvm-acp", platform: "linux/arm64" },
  });
  assert.equal(receipt.verification.kind, "microvm-acp");
});
