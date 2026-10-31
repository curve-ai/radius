import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentBuildReceiptSchema,
  AgentConfigSchema,
  AgentManifestSchema,
  HarnessPinSchema,
  HarnessRuntimeConfigSchema,
  parseHarnessPin,
  RadiusLockSchema,
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

test("a langgraph runtime needs only its kind", () => {
  const config = AgentConfigSchema.parse({
    name: "Graphs",
    runtime: { kind: "langgraph" },
  });
  assert.deepEqual(config.runtime, {
    kind: "langgraph",
    config: "langgraph.json",
    language: "python",
    python: "3.12",
    lockfile: "uv.lock",
    adapter: "radius-langgraph==0.0.1",
  });
  const pinned = AgentConfigSchema.parse({
    name: "Graphs",
    runtime: { kind: "langgraph", graph: "triage", adapter: "../adapter" },
  });
  assert.equal(
    pinned.runtime.kind === "langgraph" && pinned.runtime.graph,
    "triage",
  );
  for (const runtime of [
    { kind: "langgraph", config: "../langgraph.json" },
    { kind: "langgraph", python: "3" },
    { kind: "langgraph", graph: "" },
    { kind: "langgraph", language: "rust" },
  ]) {
    assert.equal(
      AgentConfigSchema.safeParse({ name: "Graphs", runtime }).success,
      false,
      JSON.stringify(runtime),
    );
  }
});

test("a TypeScript langgraph runtime takes no uv settings", () => {
  const config = AgentConfigSchema.parse({
    name: "Graphs",
    runtime: { kind: "langgraph", language: "typescript", graph: "agent" },
  });
  assert.deepEqual(config.runtime, {
    kind: "langgraph",
    config: "langgraph.json",
    graph: "agent",
    language: "typescript",
  });
  for (const field of ["python", "lockfile", "adapter"]) {
    const result = AgentConfigSchema.safeParse({
      name: "Graphs",
      runtime: { kind: "langgraph", language: "typescript", [field]: "3.12" },
    });
    assert.equal(result.success, false, field);
    assert.match(
      JSON.stringify(result.error?.issues),
      /applies only to \\"language\\": \\"python\\"/,
      field,
    );
  }
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

const binaryDistribution = {
  kind: "binary",
  cmd: "./opencode",
  args: ["acp"],
  platforms: {
    "linux/arm64": {
      archive: "https://example.invalid/opencode.tar.gz",
      sha256: "a".repeat(64),
    },
  },
};

test("a harness runtime carries env only when it declares one", () => {
  const bare = HarnessRuntimeConfigSchema.parse({
    kind: "harness",
    distribution: binaryDistribution,
  });
  // Absent rather than `{}`: a default would change the manifest, and with it
  // the build digest, of every harness config written before env existed.
  assert.equal("env" in bare, false);

  const withEnv = HarnessRuntimeConfigSchema.parse({
    kind: "harness",
    distribution: binaryDistribution,
    env: { OPENCODE_CONFIG: "opencode-async.json" },
  });
  assert.deepEqual(withEnv.env, { OPENCODE_CONFIG: "opencode-async.json" });

  assert.equal(
    HarnessRuntimeConfigSchema.safeParse({
      kind: "harness",
      distribution: binaryDistribution,
      env: { "NOT-A-NAME": "x" },
    }).success,
    false,
  );
});

test("a harness pin is an id and a version", () => {
  assert.deepEqual(parseHarnessPin("opencode@1.19.4"), {
    id: "opencode",
    version: "1.19.4",
  });
  assert.deepEqual(parseHarnessPin("claude-code-acp@0.10.0-beta.1"), {
    id: "claude-code-acp",
    version: "0.10.0-beta.1",
  });
  for (const pin of [
    "opencode",
    "opencode@",
    "@1.0.0",
    "a@b@c",
    "open code@1",
  ]) {
    assert.equal(HarnessPinSchema.safeParse(pin).success, false, pin);
  }
});

test("a lock holds a registry pin and nothing a person would edit", () => {
  const lock = RadiusLockSchema.parse({
    "//": "generated",
    lockfileVersion: 1,
    harness: {
      registryId: "opencode",
      version: "1.19.4",
      license: "MIT",
      distribution: binaryDistribution,
    },
  });
  assert.equal(lock.harness.distribution.kind, "binary");

  // The lock is held to the same pinning rule as an inline distribution: a
  // URL archive without a digest is not a pin.
  assert.equal(
    RadiusLockSchema.safeParse({
      lockfileVersion: 1,
      harness: {
        registryId: "opencode",
        version: "1.19.4",
        distribution: {
          ...binaryDistribution,
          platforms: {
            "linux/arm64": { archive: "https://example.invalid/o.tar.gz" },
          },
        },
      },
    }).success,
    false,
  );
  assert.equal(
    RadiusLockSchema.safeParse({ lockfileVersion: 2, harness: lock.harness })
      .success,
    false,
  );
});

test("config defaults fill everything a short radius.json leaves out", () => {
  const config = AgentConfigSchema.parse({
    agent: "agent_abcdef12",
    name: "shopfloor-agent",
    runtime: { kind: "harness", distribution: binaryDistribution },
  });
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.version, "0.0.0");
  assert.deepEqual(config.capabilities, []);
  assert.deepEqual(config.networkAllowlist, []);
  assert.deepEqual(config.resources, { cpu: 2, memoryMb: 4096, diskMb: 5120 });
});
