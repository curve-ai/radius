import { defineConfig } from "@curve-ai/build";

export default defineConfig({
  schemaVersion: 1,
  agent: "agent_example1",
  name: "TypeScript Example Agent",
  runtime: {
    kind: "typescript",
    entrypoint: "radius/agent.ts",
    node: "22",
  },
  capabilities: [],
  networkAllowlist: [],
});
