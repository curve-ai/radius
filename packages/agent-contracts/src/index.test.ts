import assert from "node:assert/strict";
import test from "node:test";

import { AgentConfigSchema, RelativeProjectPathSchema } from "./index.js";

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
