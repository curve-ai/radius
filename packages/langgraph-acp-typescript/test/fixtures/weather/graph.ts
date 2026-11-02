/** A tiny tool-calling graph driven by a scripted, offline chat model. */

import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
} from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import { tool } from "@langchain/core/tools";
import {
  MessagesAnnotation,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { z } from "zod";

// Stray output from user code must never reach the ACP stream.
console.log("weather graph module loaded");

const getWeather = tool(
  async ({ city }: { city: string }) => {
    console.log(`looking up weather for ${city}`);
    process.stdout.write("raw stdout write from a tool\n");
    return `Sunny in ${city}`;
  },
  {
    name: "get_weather",
    description: "Return the weather for a city.",
    schema: z.object({ city: z.string() }),
  },
);

const slowTool = tool(
  async () => {
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    return "finally done";
  },
  { name: "slow_tool", description: "Take a long time.", schema: z.object({}) },
);

const deploy = tool(
  async () => {
    const answer = interrupt({ question: "Deploy to production?" });
    return answer === true || answer === "yes" ? "deployed" : "deploy rejected";
  },
  {
    name: "deploy",
    description: "Deploy to production after human approval.",
    schema: z.object({}),
  },
);

const TOOLS: Record<string, string> = {
  weather: "get_weather",
  slow: "slow_tool",
  deploy: "deploy",
};

/**
 * Streams its reply token by token and its tool calls as tool-call chunks,
 * the way a provider does. LangChain's generic fake model drops tool calls
 * when streaming, so it cannot stand in here.
 */
class ScriptedModel extends BaseChatModel {
  _llmType(): string {
    return "scripted";
  }

  respond(messages: BaseMessage[]): AIMessage {
    const last = messages[messages.length - 1]!;
    const humans = messages.filter((m) => m.getType() === "human");
    if (last.getType() === "tool") {
      return new AIMessage(`Tool said: ${last.content}`);
    }
    for (const [keyword, name] of Object.entries(TOOLS)) {
      if (String(last.content).includes(keyword)) {
        const args = name === "get_weather" ? { city: "Paris" } : {};
        return new AIMessage({
          content: "",
          tool_calls: [{ name, args, id: `call_${name}_${humans.length}` }],
        });
      }
    }
    const said = humans.map((h) => String(h.content)).join(" | ");
    return new AIMessage(`You have said ${humans.length} things: ${said}`);
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const message = this.respond(messages);
    return { generations: [{ message, text: String(message.content) }] };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const message = this.respond(messages);
    for (const token of String(message.content).split(/(\s)/)) {
      if (!token) continue;
      const chunk = new ChatGenerationChunk({
        text: token,
        message: new AIMessageChunk({ content: token }),
      });
      yield chunk;
      await runManager?.handleLLMNewToken(
        token,
        undefined,
        undefined,
        undefined,
        undefined,
        { chunk },
      );
    }
    if (message.tool_calls?.length) {
      yield new ChatGenerationChunk({
        text: "",
        message: new AIMessageChunk({
          content: "",
          tool_call_chunks: message.tool_calls.map((call, index) => ({
            name: call.name,
            args: JSON.stringify(call.args),
            id: call.id,
            index,
            type: "tool_call_chunk" as const,
          })),
        }),
      });
    }
  }
}

const model = new ScriptedModel({});

async function agent(state: typeof MessagesAnnotation.State) {
  console.log("agent node running");
  return { messages: [await model.invoke(state.messages)] };
}

export const graph = new StateGraph(MessagesAnnotation)
  .addNode("agent", agent)
  .addNode("tools", new ToolNode([getWeather, slowTool, deploy]))
  .addEdge("__start__", "agent")
  .addConditionalEdges("agent", toolsCondition)
  .addEdge("tools", "agent")
  .compile();
