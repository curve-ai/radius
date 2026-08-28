import asyncio
from typing import Any

import pytest
from acp import text_block

from radius_agent_sdk import RunContext, RunResult, define_agent


class FakeClient:
    def __init__(self) -> None:
        self.updates: list[Any] = []

    async def session_update(self, session_id: str, update: Any, **kwargs: Any) -> None:
        self.updates.append((session_id, update))


@pytest.mark.asyncio
async def test_streams_text_and_returns_end_turn() -> None:
    observed: list[tuple[str, str]] = []

    async def run(context: RunContext) -> RunResult:
        observed.append((context.cwd, context.text))
        await context.send_text("Hello ")
        return RunResult(text="from Python")

    agent = define_agent(name="python-test", run=run)
    client = FakeClient()
    agent.on_connect(client)  # type: ignore[arg-type]
    session = await agent.new_session(cwd="/tmp/python-agent")
    result = await agent.prompt(session.session_id, [text_block("test prompt")])

    assert result.stop_reason == "end_turn"
    assert observed == [("/tmp/python-agent", "test prompt")]
    chunks = [update.content.text for _, update in client.updates]
    assert chunks == ["Hello ", "from Python"]


@pytest.mark.asyncio
async def test_propagates_cancellation() -> None:
    observed_context: RunContext | None = None

    async def run(context: RunContext) -> None:
        nonlocal observed_context
        observed_context = context
        await asyncio.Event().wait()

    agent = define_agent(name="cancel-test", run=run)
    client = FakeClient()
    agent.on_connect(client)  # type: ignore[arg-type]
    session = await agent.new_session(cwd="/tmp/python-agent")

    prompt = asyncio.create_task(agent.prompt(session.session_id, [text_block("wait")]))
    await asyncio.sleep(0)
    await agent.cancel(session.session_id)
    result = await prompt

    assert result.stop_reason == "cancelled"
    assert observed_context is not None
    assert observed_context.is_cancelled
