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
  development: {
    endpoint: "ws://127.0.0.1:7331/acp",
  },
  capabilities: [],
  networkAllowlist: [],
});
