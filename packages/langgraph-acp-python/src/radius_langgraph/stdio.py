"""Keep the real stdout for ACP and send everything else to stderr."""

from __future__ import annotations

import asyncio
import os
import sys
from typing import BinaryIO


class _WritePipeProtocol(asyncio.BaseProtocol):
    def __init__(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._paused = False
        self._drain_waiter: asyncio.Future[None] | None = None

    def pause_writing(self) -> None:
        self._paused = True
        if self._drain_waiter is None:
            self._drain_waiter = self._loop.create_future()

    def resume_writing(self) -> None:
        self._paused = False
        if self._drain_waiter is not None and not self._drain_waiter.done():
            self._drain_waiter.set_result(None)
        self._drain_waiter = None

    async def _drain_helper(self) -> None:
        if self._paused and self._drain_waiter is not None:
            await self._drain_waiter


def reserve_protocol_stdout() -> BinaryIO:
    """Detach the process stdout for protocol use.

    File descriptor 1 is pointed at stderr, so `print()`, logging handlers bound to
    stdout, C extensions, and child processes cannot write into the ACP stream. The
    returned binary file is the only handle on the original stdout.
    """
    sys.stdout.flush()
    protocol_fd = os.dup(1)
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    return os.fdopen(protocol_fd, "wb", buffering=0)


async def protocol_streams(
    protocol_out: BinaryIO, *, limit: int = 50 * 1024 * 1024
) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader(limit=limit)
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    write_protocol = _WritePipeProtocol()
    transport, _ = await loop.connect_write_pipe(lambda: write_protocol, protocol_out)
    writer = asyncio.StreamWriter(transport, write_protocol, None, loop)  # type: ignore[arg-type]
    return reader, writer
