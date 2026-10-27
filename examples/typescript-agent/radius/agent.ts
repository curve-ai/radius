import {
  PROTOCOL_VERSION,
  agent,
  methods,
  ndJsonStream,
} from "@agentclientprotocol/sdk";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";

export function createAgent() {
  const sessions = new Set<string>();
  return agent({ name: "typescript-example-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
    }))
    .onRequest(methods.agent.session.new, () => {
      const sessionId = randomUUID();
      sessions.add(sessionId);
      return { sessionId };
    })
    .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
      if (!sessions.has(params.sessionId)) throw new Error("Unknown session");
      const text = params.prompt
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `Radius received: ${text}` },
        },
      });
      return { stopReason: "end_turn" };
    });
}

if (process.argv.includes("--radius-dev")) {
  const { serveDevelopmentAgent } =
    await import("@curve-ai/radius-runtime/development");
  const server = await serveDevelopmentAgent(createAgent);
  console.log(`Radius ACP development endpoint: ${server.endpoint}`);
} else {
  createAgent().connect(
    ndJsonStream(
      Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
      Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
    ),
  );
}
