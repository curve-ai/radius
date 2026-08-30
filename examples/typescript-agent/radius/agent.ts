import { defineAgent } from "@curve-ai/sdk";

const agent = defineAgent({
  name: "typescript-example-agent",
  async run({ text }) {
    return { text: `Radius received: ${text}` };
  },
});

if (process.argv.includes("--radius-dev")) {
  const { serveDevelopmentAgent } = await import("@curve-ai/sdk/development");
  const server = await serveDevelopmentAgent(agent);
  console.log(`Radius ACP development endpoint: ${server.endpoint}`);
} else {
  agent.serveStdio();
}
