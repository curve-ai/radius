/** Graphs exposed every way an export can be: factories, a builder, compiled. */

import { AIMessage } from "@langchain/core/messages";
import {
  MemorySaver,
  MessagesAnnotation,
  StateGraph,
} from "@langchain/langgraph";

function singleNode(reply) {
  return new StateGraph(MessagesAnnotation)
    .addNode("respond", (state) => ({
      messages: [new AIMessage(reply(String(state.messages.at(-1).content)))],
    }))
    .addEdge("__start__", "respond");
}

export function echoFactory(config) {
  if (!config?.configurable)
    throw new Error("factory expected a RunnableConfig");
  return singleNode((text) => `echo: ${text}`).compile();
}

export async function shoutFactory() {
  return singleNode((text) => text.toUpperCase()).compile();
}

// Already has a checkpointer; the adapter must keep it.
export const remembered = singleNode(() => "noted").compile({
  checkpointer: new MemorySaver(),
});

// Opted out of persistence; the adapter must leave it that way.
export const forgetful = singleNode(() => "forgotten").compile({
  checkpointer: false,
});

// Not compiled; the adapter compiles it.
export default singleNode((text) => `${text.length} characters`);
