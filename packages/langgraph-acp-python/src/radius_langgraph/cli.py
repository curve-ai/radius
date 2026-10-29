"""`radius-langgraph`: serve the graphs in `langgraph.json` over ACP on stdio."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import sys
from pathlib import Path
from typing import BinaryIO

from acp import run_agent

from . import __version__
from .agent import LangGraphAgent
from .config import ConfigError, apply_env, load_config
from .loader import GraphLoadError, load_graphs
from .stdio import protocol_streams, reserve_protocol_stdout


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="radius-langgraph",
        description="Serve LangGraph graphs over the Agent Client Protocol on stdio.",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path("langgraph.json"),
        help="path to langgraph.json (default: ./langgraph.json)",
    )
    parser.add_argument("--graph", help="serve only this graph from langgraph.json")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    return parser.parse_args(argv)


async def _serve(args: argparse.Namespace, protocol_out: BinaryIO) -> int:
    async with contextlib.AsyncExitStack() as stack:
        try:
            config = load_config(args.config)
            apply_env(config)
            graphs = await load_graphs(config, stack, only=args.graph)
        except (ConfigError, GraphLoadError) as exc:
            print(f"radius-langgraph: {exc}", file=sys.stderr)
            return 1
        except Exception as exc:
            logging.exception("radius-langgraph: failed to load graphs")
            print(f"radius-langgraph: failed to load graphs: {exc!r}", file=sys.stderr)
            return 1

        reader, writer = await protocol_streams(protocol_out)
        await run_agent(LangGraphAgent(graphs), input_stream=writer, output_stream=reader)
    return 0


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    if sys.platform == "win32":
        print("radius-langgraph: Windows is not supported yet", file=sys.stderr)
        sys.exit(1)
    # Claim stdout before any user module is imported.
    protocol_out = reserve_protocol_stdout()
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
    try:
        code = asyncio.run(_serve(args, protocol_out))
    except KeyboardInterrupt:
        code = 130
    sys.exit(code)


if __name__ == "__main__":
    main()
