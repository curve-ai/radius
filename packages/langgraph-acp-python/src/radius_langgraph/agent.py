"""ACP agent that drives LangGraph graphs."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from acp import (
    PROTOCOL_VERSION,
    Agent,
    InitializeResponse,
    LoadSessionResponse,
    NewSessionResponse,
    PromptResponse,
    RequestError,
    SetSessionModeResponse,
    start_tool_call,
    text_block,
    tool_content,
    update_agent_message_text,
    update_agent_thought_text,
    update_tool_call,
    update_user_message_text,
)
from acp.interfaces import Client
from acp.schema import (
    AgentCapabilities,
    Implementation,
    PermissionOption,
    PromptCapabilities,
    SessionMode,
    SessionModeState,
    ToolCallUpdate,
)
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.pregel import Pregel
from langgraph.types import Command

from . import __version__
from .loader import LoadedGraph

logger = logging.getLogger(__name__)

AGENT_NAME = "radius-langgraph"
_AFFIRMATIVE = {"y", "yes", "ok", "okay", "approve", "approved", "allow", "accept", "continue"}


@dataclass
class _Session:
    id: str
    mode: str
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    task: asyncio.Task[str] | None = None
    cancel_requested: bool = False


_CANCELLED = object()
_UNSUPPORTED = object()


def message_text(message: BaseMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content
    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text", "")))
    return "".join(parts)


def _message_thoughts(message: BaseMessage) -> str:
    if isinstance(message.content, str):
        return ""
    parts: list[str] = []
    for block in message.content:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "thinking":
            parts.append(str(block.get("thinking", "")))
        elif block.get("type") == "reasoning":
            parts.append(str(block.get("reasoning", "")))
    return "".join(parts)


def prompt_text(prompt: Iterable[Any]) -> str:
    parts: list[str] = []
    for block in prompt:
        kind = getattr(block, "type", None)
        if kind == "text":
            parts.append(block.text)
        elif kind == "resource_link":
            parts.append(f"[{block.name}]({block.uri})")
        elif kind == "resource":
            resource = block.resource
            text = getattr(resource, "text", None)
            if text is not None:
                parts.append(f"<resource uri={resource.uri!r}>\n{text}\n</resource>")
    return "\n".join(parts)


def _messages_in(update: Any) -> list[BaseMessage]:
    if isinstance(update, BaseMessage):
        return [update]
    if isinstance(update, Command):
        return _messages_in(update.update)
    if isinstance(update, list | tuple):
        return [m for item in update for m in _messages_in(item)]
    if isinstance(update, dict):
        messages = update.get("messages")
        if messages is None:
            return []
        if not isinstance(messages, list | tuple):
            messages = [messages]
        return [m for m in messages if isinstance(m, BaseMessage)]
    return []


def _json_safe(value: Any) -> Any:
    try:
        return json.loads(json.dumps(value, default=str))
    except (TypeError, ValueError):
        return str(value)


def _is_hitl_request(value: Any) -> bool:
    return isinstance(value, dict) and isinstance(value.get("action_requests"), list)


def _interrupt_title(value: Any) -> str:
    if isinstance(value, str):
        return value
    if _is_hitl_request(value):
        names = [str(action.get("name", "action")) for action in value["action_requests"]]
        return f"Approve {', '.join(names)}"
    if isinstance(value, dict):
        for key in ("question", "message", "description", "title", "prompt"):
            if isinstance(value.get(key), str):
                return value[key]
    text = json.dumps(_json_safe(value))
    return text if len(text) <= 200 else text[:197] + "..."


def _custom_options(value: Any) -> list[str] | None:
    if isinstance(value, dict) and isinstance(value.get("options"), list):
        options = [str(option) for option in value["options"]]
        return options or None
    return None


def _hitl_resume(value: dict[str, Any], approved: bool, message: str | None) -> dict[str, Any]:
    decision: dict[str, Any] = {"type": "approve"} if approved else {"type": "reject"}
    if not approved and message:
        decision["message"] = message
    return {"decisions": [dict(decision) for _ in value["action_requests"]]}


def resume_from_text(value: Any, text: str) -> Any:
    """Resume value for an interrupt answered by a plain-text prompt."""
    affirmative = text.strip().lower().rstrip(".!") in _AFFIRMATIVE
    if _is_hitl_request(value):
        return _hitl_resume(value, affirmative, None if affirmative else text)
    options = _custom_options(value)
    if options:
        for option in options:
            if option.lower() == text.strip().lower():
                return option
    return text


class _Turn:
    """Translates LangGraph stream events into ACP session updates for one turn."""

    def __init__(self, client: Client, session_id: str) -> None:
        self.client = client
        self.session_id = session_id
        self.open_tool_calls: dict[str, str] = {}

    async def send(self, update: Any) -> None:
        await self.client.session_update(session_id=self.session_id, update=update)

    async def on_message_chunk(self, message: BaseMessage) -> None:
        if not isinstance(message, AIMessage):
            return
        thoughts = _message_thoughts(message)
        if thoughts:
            await self.send(update_agent_thought_text(thoughts))
        text = message_text(message)
        if text:
            await self.send(update_agent_message_text(text))

    async def on_update(self, update: Any) -> None:
        if not isinstance(update, dict):
            return
        for node, value in update.items():
            if node == "__interrupt__":
                continue
            for message in _messages_in(value):
                await self.on_tool_activity(message)

    async def on_tool_activity(self, message: BaseMessage) -> None:
        if isinstance(message, AIMessage):
            for call in message.tool_calls:
                call_id = call.get("id")
                if not call_id or call_id in self.open_tool_calls:
                    continue
                self.open_tool_calls[call_id] = call["name"]
                await self.send(
                    start_tool_call(
                        call_id,
                        call["name"],
                        kind="other",
                        status="in_progress",
                        raw_input=_json_safe(call.get("args", {})),
                    )
                )
        elif isinstance(message, ToolMessage):
            self.open_tool_calls.pop(message.tool_call_id, None)
            output = message_text(message)
            await self.send(
                update_tool_call(
                    message.tool_call_id,
                    status="failed" if message.status == "error" else "completed",
                    content=[tool_content(text_block(output))],
                    raw_output=output,
                )
            )

    async def fail_open_tool_calls(self) -> None:
        for call_id in list(self.open_tool_calls):
            self.open_tool_calls.pop(call_id, None)
            await self.send(update_tool_call(call_id, status="failed"))

    async def replay(self, messages: Iterable[BaseMessage]) -> None:
        for message in messages:
            if isinstance(message, HumanMessage):
                text = message_text(message)
                if text:
                    await self.send(update_user_message_text(text))
            elif isinstance(message, AIMessage):
                await self.on_message_chunk(message)
                await self.on_tool_activity(message)
            elif isinstance(message, ToolMessage):
                await self.on_tool_activity(message)


class LangGraphAgent(Agent):
    def __init__(self, graphs: list[LoadedGraph]) -> None:
        if not graphs:
            raise ValueError("at least one graph is required")
        self.graphs = {loaded.name: loaded for loaded in graphs}
        self.default_mode = graphs[0].name
        self.client: Client | None = None
        self.sessions: dict[str, _Session] = {}

    def on_connect(self, conn: Client) -> None:
        self.client = conn

    # -- ACP methods -------------------------------------------------------------

    async def initialize(self, protocol_version: int, **kwargs: Any) -> InitializeResponse:
        return InitializeResponse(
            protocol_version=min(protocol_version, PROTOCOL_VERSION),
            agent_capabilities=AgentCapabilities(
                load_session=True,
                prompt_capabilities=PromptCapabilities(
                    image=False, audio=False, embedded_context=True
                ),
            ),
            agent_info=Implementation(name=AGENT_NAME, title="LangGraph", version=__version__),
        )

    async def new_session(self, cwd: str, **kwargs: Any) -> NewSessionResponse:
        session = _Session(id=uuid4().hex, mode=self.default_mode)
        self.sessions[session.id] = session
        return NewSessionResponse(session_id=session.id, modes=self._modes(session.mode))

    async def load_session(
        self, cwd: str, session_id: str, **kwargs: Any
    ) -> LoadSessionResponse | None:
        mode = self.default_mode
        messages: list[BaseMessage] = []
        for name in [self.default_mode, *(n for n in self.graphs if n != self.default_mode)]:
            found = await self._history(name, session_id)
            if found is not None:
                mode, messages = name, found
                break
        session = self.sessions.get(session_id) or _Session(id=session_id, mode=mode)
        session.mode = mode
        self.sessions[session_id] = session
        if messages and self.client is not None:
            await _Turn(self.client, session_id).replay(messages)
        return LoadSessionResponse(modes=self._modes(mode))

    async def set_session_mode(
        self, session_id: str, mode_id: str, **kwargs: Any
    ) -> SetSessionModeResponse | None:
        session = self._session(session_id)
        if mode_id not in self.graphs:
            raise RequestError.invalid_params(
                {"modeId": mode_id, "availableModes": list(self.graphs)}
            )
        session.mode = mode_id
        return SetSessionModeResponse()

    async def prompt(self, session_id: str, prompt: list[Any], **kwargs: Any) -> PromptResponse:
        session = self._session(session_id)
        if self.client is None:
            raise RequestError.internal_error({"details": "client is not connected"})
        async with session.lock:
            session.cancel_requested = False
            task = asyncio.create_task(self._run_turn(session, prompt_text(prompt)))
            session.task = task
            try:
                stop_reason = await task
            except asyncio.CancelledError:
                current = asyncio.current_task()
                if session.cancel_requested and not (current and current.cancelling()):
                    return PromptResponse(stop_reason="cancelled")
                raise
            finally:
                session.task = None
            return PromptResponse(stop_reason=stop_reason)  # type: ignore[arg-type]

    async def cancel(self, session_id: str, **kwargs: Any) -> None:
        session = self.sessions.get(session_id)
        if session is None or session.task is None:
            return
        session.cancel_requested = True
        session.task.cancel()

    # -- helpers -----------------------------------------------------------------

    def _session(self, session_id: str) -> _Session:
        session = self.sessions.get(session_id)
        if session is None:
            raise RequestError.invalid_params(
                {"sessionId": session_id, "reason": "unknown session"}
            )
        return session

    def _modes(self, current: str) -> SessionModeState:
        return SessionModeState(
            current_mode_id=current,
            available_modes=[
                SessionMode(id=name, name=name, description=loaded.description)
                for name, loaded in self.graphs.items()
            ],
        )

    def _thread_id(self, mode: str, session_id: str) -> str:
        # One thread per session; graphs with different state schemas never share a thread.
        return session_id if len(self.graphs) == 1 else f"{session_id}:{mode}"

    def _config(self, mode: str, session_id: str) -> dict[str, Any]:
        return {"configurable": {"thread_id": self._thread_id(mode, session_id)}}

    async def _state(self, graph: Pregel, config: dict[str, Any]) -> Any | None:
        if not isinstance(graph.checkpointer, BaseCheckpointSaver):
            return None
        try:
            return await graph.aget_state(config)
        except ValueError:
            return None

    async def _history(self, mode: str, session_id: str) -> list[BaseMessage] | None:
        state = await self._state(self.graphs[mode].graph, self._config(mode, session_id))
        if state is None or not state.values:
            return None
        values = state.values
        messages = values.get("messages", []) if isinstance(values, dict) else []
        return [m for m in messages if isinstance(m, BaseMessage)]

    async def _pending_interrupts(self, graph: Pregel, config: dict[str, Any]) -> list[Any]:
        state = await self._state(graph, config)
        if state is None:
            return []
        interrupts = list(getattr(state, "interrupts", ()) or ())
        if not interrupts:
            for task in state.tasks:
                interrupts.extend(task.interrupts)
        return interrupts

    async def _initial_input(self, graph: Pregel, config: dict[str, Any], text: str) -> Any:
        pending = await self._pending_interrupts(graph, config)
        if pending:
            return self._resume_command([(i, resume_from_text(i.value, text)) for i in pending])

        messages: list[BaseMessage] = []
        state = await self._state(graph, config)
        if state is not None and isinstance(state.values, dict):
            history = state.values.get("messages") or []
            messages.extend(_dangling_tool_results(history))
        messages.append(HumanMessage(content=text))
        return {"messages": messages}

    @staticmethod
    def _resume_command(answers: list[tuple[Any, Any]]) -> Command:
        if len(answers) == 1 and getattr(answers[0][0], "id", None) is None:
            return Command(resume=answers[0][1])
        return Command(resume={interrupt.id: value for interrupt, value in answers})

    async def _run_turn(self, session: _Session, text: str) -> str:
        assert self.client is not None
        graph = self.graphs[session.mode].graph
        config = self._config(session.mode, session.id)
        turn = _Turn(self.client, session.id)
        graph_input = await self._initial_input(graph, config, text)
        try:
            while True:
                async for mode, data in graph.astream(
                    graph_input, config=config, stream_mode=["messages", "updates"]
                ):
                    if mode == "messages":
                        await turn.on_message_chunk(data[0])
                    elif mode == "updates":
                        await turn.on_update(data)

                pending = await self._pending_interrupts(graph, config)
                if not pending:
                    return "end_turn"
                answers: list[tuple[Any, Any]] = []
                for interrupt in pending:
                    answer = await self._ask_permission(turn, interrupt)
                    if answer is _CANCELLED:
                        return "cancelled"
                    if answer is _UNSUPPORTED:
                        await self._ask_in_text(turn, pending)
                        return "end_turn"
                    answers.append((interrupt, answer))
                graph_input = self._resume_command(answers)
        except asyncio.CancelledError:
            await asyncio.shield(turn.fail_open_tool_calls())
            raise
        except Exception:
            await turn.fail_open_tool_calls()
            raise

    async def _ask_permission(self, turn: _Turn, interrupt: Any) -> Any:
        value = interrupt.value
        title = _interrupt_title(value)
        options, resolve = _permission_options(value)

        if len(turn.open_tool_calls) == 1:
            call_id = next(iter(turn.open_tool_calls))
            synthesized = False
        else:
            call_id = f"interrupt-{getattr(interrupt, 'id', None) or uuid4().hex}"
            synthesized = True
            await turn.send(
                start_tool_call(
                    call_id, title, kind="other", status="pending", raw_input=_json_safe(value)
                )
            )

        try:
            response = await turn.client.request_permission(
                session_id=turn.session_id,
                tool_call=ToolCallUpdate(
                    tool_call_id=call_id, title=title, raw_input=_json_safe(value)
                ),
                options=options,
            )
        except RequestError as exc:
            logger.warning("request_permission failed (%s); asking in text instead", exc)
            if synthesized:
                await turn.send(update_tool_call(call_id, status="failed"))
            return _UNSUPPORTED

        outcome = response.outcome
        if outcome.outcome != "selected":
            if synthesized:
                await turn.send(update_tool_call(call_id, status="failed"))
            return _CANCELLED
        answer = resolve(outcome.option_id)
        if synthesized:
            await turn.send(
                update_tool_call(call_id, status="completed", raw_output=_json_safe(answer))
            )
        return answer

    async def _ask_in_text(self, turn: _Turn, pending: list[Any]) -> None:
        lines = ["The graph is waiting for input:"]
        for interrupt in pending:
            line = f"- {_interrupt_title(interrupt.value)}"
            options = _custom_options(interrupt.value)
            if options:
                line += f" (options: {', '.join(options)})"
            lines.append(line)
        lines.append("Reply to continue.")
        await turn.send(update_agent_message_text("\n".join(lines)))


def _permission_options(value: Any) -> tuple[list[PermissionOption], Callable[[str], Any]]:
    custom = _custom_options(value)
    if custom:
        options = [
            PermissionOption(
                option_id=option,
                name=option,
                kind="reject_once"
                if option.lower() in {"no", "reject", "deny", "cancel"}
                else "allow_once",
            )
            for option in custom
        ]
        return options, lambda option_id: option_id

    options = [
        PermissionOption(option_id="approve", name="Approve", kind="allow_once"),
        PermissionOption(option_id="reject", name="Reject", kind="reject_once"),
    ]
    if _is_hitl_request(value):
        return options, lambda option_id: _hitl_resume(
            value, option_id == "approve", None if option_id == "approve" else "Rejected by user."
        )
    return options, lambda option_id: option_id == "approve"


def _dangling_tool_results(history: list[Any]) -> list[ToolMessage]:
    """Tool results for calls a cancelled turn never answered, so providers accept the history."""
    last_ai = next((m for m in reversed(history) if isinstance(m, AIMessage)), None)
    if last_ai is None or not last_ai.tool_calls:
        return []
    answered = {m.tool_call_id for m in history if isinstance(m, ToolMessage)}
    return [
        ToolMessage(
            content="Cancelled before completion.",
            tool_call_id=call["id"],
            name=call["name"],
            status="error",
        )
        for call in last_ai.tool_calls
        if call.get("id") and call["id"] not in answered
    ]
