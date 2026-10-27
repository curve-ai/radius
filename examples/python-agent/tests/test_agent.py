from typing import Any

import pytest
from acp import text_block

from radius_python_agent.agent import EchoAgent


class Client:
    def __init__(self) -> None:
        self.updates: list[Any] = []

    async def session_update(self, **kwargs: Any) -> None:
        self.updates.append(kwargs)


@pytest.mark.asyncio
async def test_acp_session_streams_response() -> None:
    agent = EchoAgent()
    client = Client()
    agent.on_connect(client)  # type: ignore[arg-type]
    initialized = await agent.initialize(protocol_version=1)
    assert initialized.protocol_version == 1
    session = await agent.new_session(cwd="/tmp/python-agent")
    result = await agent.prompt(session.session_id, [text_block("hello")])
    assert result.stop_reason == "end_turn"
    assert client.updates[0]["update"].content.text == "Radius Python received: hello"


@pytest.mark.asyncio
async def test_unknown_session_is_rejected() -> None:
    agent = EchoAgent()
    with pytest.raises(ValueError, match="Unknown"):
        await agent.prompt("missing", [text_block("hello")])
