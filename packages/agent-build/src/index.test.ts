import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson, createAgentManifest, defineConfig } from "./index.js";

test("creates an ACP manifest from normalized config", () => {
  const config = defineConfig({
    agent: "agent_example1",
    name: "Example agent",
    runtime: { kind: "typescript", entrypoint: "radius/agent.ts" },
  });
  const manifest = createAgentManifest(config);
  assert.deepEqual(manifest.protocol, { kind: "acp-stdio", version: 1 });
  assert.equal(manifest.agent, "agent_example1");
  assert.equal(manifest.minimumDesktopVersion, "0.0.1");
});

test("canonical JSON sorts object keys without reordering arrays", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: 2, b: [3, 1] } }),
    '{\n  "a": {\n    "b": [\n      3,\n      1\n    ],\n    "y": 2\n  },\n  "z": 1\n}\n',
  );
});
