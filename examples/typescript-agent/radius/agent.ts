import { defineAgent } from "@curve-ai/sdk";

const agent = defineAgent({
  name: "typescript-example-agent",
  async run({ text }) {
    return { text: `Radius received: ${text}` };
  },
});

agent.serveStdio();
