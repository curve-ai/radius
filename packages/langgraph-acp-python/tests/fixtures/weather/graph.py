"""A tiny tool-calling graph driven by a scripted, offline chat model."""

import asyncio
import json
import re
from collections.abc import Iterator
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    ToolMessage,
)
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_core.tools import tool
from langgraph.graph import START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.types import interrupt

# Stray output from user code must never reach the ACP stream.
print("weather graph module loaded")


@tool
def get_weather(city: str) -> str:
    """Return the weather for a city."""
    print(f"looking up weather for {city}")
    return f"Sunny in {city}"


@tool
async def slow_tool() -> str:
    """Take a long time."""
    await asyncio.sleep(30)
    return "finally done"


@tool
def deploy() -> str:
    """Deploy to production after human approval."""
    answer = interrupt({"question": "Deploy to production?"})
    return "deployed" if answer is True or answer == "yes" else "deploy rejected"


TOOLS = {"weather": "get_weather", "slow": "slow_tool", "deploy": "deploy"}


class ScriptedModel(BaseChatModel):
    @property
    def _llm_type(self) -> str:
        return "scripted"

    def _respond(self, messages: list[BaseMessage]) -> AIMessage:
        last = messages[-1]
        humans = [m for m in messages if isinstance(m, HumanMessage)]
        if isinstance(last, ToolMessage):
            return AIMessage(content=f"Tool said: {last.content}")
        for keyword, name in TOOLS.items():
            if keyword in str(last.content):
                args = {"city": "Paris"} if name == "get_weather" else {}
                call = {"name": name, "args": args, "id": f"call_{name}_{len(humans)}"}
                return AIMessage(content="", tool_calls=[call])
        said = " | ".join(str(h.content) for h in humans)
        return AIMessage(content=f"You have said {len(humans)} things: {said}")

    def _generate(self, messages: list[BaseMessage], *args: Any, **kwargs: Any) -> ChatResult:
        return ChatResult(generations=[ChatGeneration(message=self._respond(messages))])

    def _stream(
        self, messages: list[BaseMessage], *args: Any, **kwargs: Any
    ) -> Iterator[ChatGenerationChunk]:
        message = self._respond(messages)
        run_manager = kwargs.get("run_manager")
        for token in re.split(r"(\s)", str(message.content)):
            if not token:
                continue
            chunk = ChatGenerationChunk(message=AIMessageChunk(content=token))
            if run_manager:
                run_manager.on_llm_new_token(token, chunk=chunk)
            yield chunk
        if message.tool_calls:
            chunks = [
                {"name": c["name"], "args": json.dumps(c["args"]), "id": c["id"], "index": i}
                for i, c in enumerate(message.tool_calls)
            ]
            yield ChatGenerationChunk(message=AIMessageChunk(content="", tool_call_chunks=chunks))


model = ScriptedModel()


def agent(state: MessagesState) -> dict[str, Any]:
    print("agent node running")
    return {"messages": [model.invoke(state["messages"])]}


builder = StateGraph(MessagesState)
builder.add_node("agent", agent)
builder.add_node("tools", ToolNode([get_weather, slow_tool, deploy]))
builder.add_edge(START, "agent")
builder.add_conditional_edges("agent", tools_condition)
builder.add_edge("tools", "agent")

graph = builder.compile()
