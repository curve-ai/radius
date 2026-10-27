from typing import Any
from uuid import uuid4

from acp import (
    Agent,
    InitializeResponse,
    NewSessionResponse,
    PromptResponse,
    run_agent,
    text_block,
    update_agent_message,
)
from acp.interfaces import Client


class EchoAgent(Agent):
    def __init__(self) -> None:
        self.client: Client | None = None
        self.sessions: set[str] = set()

    def on_connect(self, conn: Client) -> None:
        self.client = conn

    async def initialize(self, protocol_version: int, **kwargs: Any) -> InitializeResponse:
        return InitializeResponse(protocol_version=protocol_version)

    async def new_session(self, cwd: str, **kwargs: Any) -> NewSessionResponse:
        session_id = uuid4().hex
        self.sessions.add(session_id)
        return NewSessionResponse(session_id=session_id)

    async def prompt(self, session_id: str, prompt: list[Any], **kwargs: Any) -> PromptResponse:
        if session_id not in self.sessions or self.client is None:
            raise ValueError("Unknown or disconnected session")
        text = "\n".join(block.text for block in prompt if getattr(block, "type", None) == "text")
        await self.client.session_update(
            session_id=session_id,
            update=update_agent_message(text_block(f"Radius Python received: {text}")),
        )
        return PromptResponse(stop_reason="end_turn")


if __name__ == "__main__":
    import asyncio

    asyncio.run(run_agent(EchoAgent()))
