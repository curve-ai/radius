"""Two graphs exposed through factories, referenced as `module:attr`."""

from typing import Any

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, MessagesState, StateGraph


def _single_node(reply: Any, **compile_kwargs: Any) -> Any:
    def respond(state: MessagesState) -> dict[str, Any]:
        return {"messages": [AIMessage(content=reply(str(state["messages"][-1].content)))]}

    builder = StateGraph(MessagesState)
    builder.add_node("respond", respond)
    builder.add_edge(START, "respond")
    return builder.compile(**compile_kwargs)


def echo_factory(config: RunnableConfig) -> Any:
    return _single_node(lambda text: f"echo: {text}")


async def shout_factory() -> Any:
    return _single_node(lambda text: text.upper())


# Already has a checkpointer; the adapter must keep it.
remembered = _single_node(lambda text: "noted", checkpointer=InMemorySaver())
