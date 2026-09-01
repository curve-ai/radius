from __future__ import annotations

import asyncio
import inspect
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal, TypeAlias
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
from acp.schema import (
    AudioContentBlock,
    ClientCapabilities,
    EmbeddedResourceContentBlock,
    ImageContentBlock,
    Implementation,
    ResourceContentBlock,
    SessionInfoUpdate,
    TextContentBlock,
)

StopReason: TypeAlias = Literal[
    "end_turn",
    "max_tokens",
    "max_turn_requests",
    "refusal",
    "cancelled",
]


@dataclass(frozen=True, slots=True)
class RunResult:
    text: str | None = None
    stop_reason: StopReason = "end_turn"


class RunContext:
    def __init__(
        self,
        *,
        session_id: str,
        cwd: str,
        prompt: list[Any],
        text: str,
        client: Client,
        cancelled: asyncio.Event,
    ) -> None:
        self.session_id = session_id
        self.cwd = cwd
        self.prompt = prompt
        self.text = text
        self._client = client
        self._cancelled = cancelled

    @property
    def is_cancelled(self) -> bool:
        return self._cancelled.is_set()

    async def wait_cancelled(self) -> None:
        await self._cancelled.wait()

    def raise_if_cancelled(self) -> None:
        if self.is_cancelled:
            raise asyncio.CancelledError

    async def send_text(self, text: str) -> None:
        if not text:
            return
        self.raise_if_cancelled()
        await self._client.session_update(
            session_id=self.session_id,
            update=update_agent_message(text_block(text)),
        )

    async def set_session_title(self, title: str) -> None:
        normalized = title.strip()
        if not normalized:
            raise ValueError("Session title is required")
        self.raise_if_cancelled()
        await self._client.session_update(
            session_id=self.session_id,
            update=SessionInfoUpdate(
                session_update="session_info_update",
                title=normalized,
            ),
        )


RunOutput: TypeAlias = None | str | RunResult
RunHandler: TypeAlias = Callable[[RunContext], RunOutput | Awaitable[RunOutput]]


@dataclass(slots=True)
class _Session:
    cwd: str
    active_task: asyncio.Task[Any] | None = None
    cancelled: asyncio.Event | None = None


class RadiusAgent(Agent):
    def __init__(self, *, name: str, run: RunHandler) -> None:
        if not name.strip():
            raise ValueError("Agent name is required")
        self.name = name
        self._run = run
        self._client: Client | None = None
        self._sessions: dict[str, _Session] = {}

    def on_connect(self, conn: Client) -> None:
        self._client = conn

    async def initialize(
        self,
        protocol_version: int,
        client_capabilities: ClientCapabilities | None = None,
        client_info: Implementation | None = None,
        **kwargs: Any,
    ) -> InitializeResponse:
        del client_capabilities, client_info, kwargs
        return InitializeResponse(protocol_version=protocol_version)

    async def new_session(
        self,
        cwd: str,
        additional_directories: list[str] | None = None,
        mcp_servers: list[Any] | None = None,
        **kwargs: Any,
    ) -> NewSessionResponse:
        del additional_directories, mcp_servers, kwargs
        session_id = uuid4().hex
        self._sessions[session_id] = _Session(cwd=cwd)
        return NewSessionResponse(session_id=session_id)

    async def prompt(
        self,
        session_id: str,
        prompt: list[
            TextContentBlock
            | ImageContentBlock
            | AudioContentBlock
            | ResourceContentBlock
            | EmbeddedResourceContentBlock
        ],
        **kwargs: Any,
    ) -> PromptResponse:
        del kwargs
        session = self._sessions.get(session_id)
        if session is None:
            raise ValueError(f"Unknown Radius session {session_id}")
        if self._client is None:
            raise RuntimeError("Radius agent is not connected")

        if session.active_task is not None:
            session.active_task.cancel()
        cancelled = asyncio.Event()
        task = asyncio.current_task()
        session.active_task = task
        session.cancelled = cancelled
        context = RunContext(
            session_id=session_id,
            cwd=session.cwd,
            prompt=list(prompt),
            text="\n".join(_text_content(block) for block in prompt if _text_content(block)),
            client=self._client,
            cancelled=cancelled,
        )

        try:
            output = self._run(context)
            result = await output if inspect.isawaitable(output) else output
            if cancelled.is_set():
                return PromptResponse(stop_reason="cancelled")
            if isinstance(result, str):
                await context.send_text(result)
                return PromptResponse(stop_reason="end_turn")
            if isinstance(result, RunResult):
                if result.text:
                    await context.send_text(result.text)
                return PromptResponse(stop_reason=result.stop_reason)
            return PromptResponse(stop_reason="end_turn")
        except asyncio.CancelledError:
            cancelled.set()
            return PromptResponse(stop_reason="cancelled")
        finally:
            if session.active_task is task:
                session.active_task = None
                session.cancelled = None

    async def cancel(self, session_id: str, **kwargs: Any) -> None:
        del kwargs
        session = self._sessions.get(session_id)
        if session is None:
            return
        if session.cancelled is not None:
            session.cancelled.set()
        if session.active_task is not None:
            session.active_task.cancel()


def define_agent(*, name: str, run: RunHandler) -> RadiusAgent:
    return RadiusAgent(name=name, run=run)


async def serve_stdio_async(agent: RadiusAgent) -> None:
    await run_agent(agent)


def serve_stdio(agent: RadiusAgent) -> None:
    asyncio.run(serve_stdio_async(agent))


def _text_content(block: Any) -> str:
    value = block.get("text") if isinstance(block, dict) else getattr(block, "text", None)
    return value if isinstance(value, str) else ""


__all__ = [
    "RadiusAgent",
    "RunContext",
    "RunHandler",
    "RunResult",
    "StopReason",
    "define_agent",
    "serve_stdio",
    "serve_stdio_async",
]
