"""A raw JSON-RPC ACP client that drives `radius-langgraph` as a subprocess."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

PermissionHandler = Callable[[dict[str, Any]], dict[str, Any]]


def approve(params: dict[str, Any]) -> dict[str, Any]:
    return {"outcome": {"outcome": "selected", "optionId": "approve"}}


class AcpProcess:
    def __init__(self, proc: asyncio.subprocess.Process) -> None:
        self.proc = proc
        self.next_id = 1
        self.pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self.notifications: list[dict[str, Any]] = []
        self.permission_requests: list[dict[str, Any]] = []
        self.on_permission: PermissionHandler = approve
        self.stdout_lines: list[bytes] = []
        self.bad_lines: list[bytes] = []
        self.new_notification = asyncio.Event()
        self.stderr_chunks: list[bytes] = []
        self._reader = asyncio.create_task(self._read())
        self._stderr_reader = asyncio.create_task(self._read_stderr())

    @classmethod
    async def start(cls, cwd: Path, *args: str) -> AcpProcess:
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "radius_langgraph",
            *args,
            cwd=cwd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
            limit=10 * 1024 * 1024,
        )
        return cls(proc)

    async def _read(self) -> None:
        assert self.proc.stdout is not None
        while line := await self.proc.stdout.readline():
            self.stdout_lines.append(line)
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                self.bad_lines.append(line)
                continue
            if "method" in message and "id" in message:
                await self._answer(message)
            elif "id" in message:
                future = self.pending.pop(message["id"], None)
                if future is not None and not future.done():
                    future.set_result(message)
            else:
                self.notifications.append(message)
                self.new_notification.set()

    async def _read_stderr(self) -> None:
        assert self.proc.stderr is not None
        while chunk := await self.proc.stderr.read(65536):
            self.stderr_chunks.append(chunk)

    async def _answer(self, message: dict[str, Any]) -> None:
        if message["method"] == "session/request_permission":
            self.permission_requests.append(message["params"])
            result = self.on_permission(message["params"])
            await self._send({"jsonrpc": "2.0", "id": message["id"], "result": result})
        else:
            error = {"code": -32601, "message": f"method not found: {message['method']}"}
            await self._send({"jsonrpc": "2.0", "id": message["id"], "error": error})

    async def _send(self, payload: dict[str, Any]) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(payload).encode() + b"\n")
        await self.proc.stdin.drain()

    async def request(self, method: str, params: dict[str, Any], timeout: float = 20) -> Any:
        request_id = self.next_id
        self.next_id += 1
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        await self._send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        response = await asyncio.wait_for(future, timeout)
        if "error" in response:
            raise RuntimeError(f"{method} failed: {response['error']}")
        return response["result"]

    async def notify(self, method: str, params: dict[str, Any]) -> None:
        await self._send({"jsonrpc": "2.0", "method": method, "params": params})

    async def initialize(self) -> Any:
        return await self.request("initialize", {"protocolVersion": 1, "clientCapabilities": {}})

    def updates(self, session_id: str, kind: str | None = None) -> list[dict[str, Any]]:
        return [
            n["params"]["update"]
            for n in self.notifications
            if n.get("method") == "session/update"
            and n["params"]["sessionId"] == session_id
            and (kind is None or n["params"]["update"]["sessionUpdate"] == kind)
        ]

    def agent_text(self, session_id: str) -> str:
        return "".join(
            u["content"]["text"] for u in self.updates(session_id, "agent_message_chunk")
        )

    async def wait_for_update(self, session_id: str, kind: str, timeout: float = 20) -> None:
        async def wait() -> None:
            while not self.updates(session_id, kind):
                self.new_notification.clear()
                await self.new_notification.wait()

        await asyncio.wait_for(wait(), timeout)

    def clear(self) -> None:
        self.notifications.clear()

    async def close(self) -> tuple[int, str]:
        assert self.proc.stdin is not None
        self.proc.stdin.close()
        try:
            await asyncio.wait_for(self.proc.wait(), 10)
        except TimeoutError:
            self.proc.kill()
            await self.proc.wait()
        await self._reader
        await self._stderr_reader
        return self.proc.returncode or 0, b"".join(self.stderr_chunks).decode()
