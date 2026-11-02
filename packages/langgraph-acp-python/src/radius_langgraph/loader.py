"""Import graphs named in `langgraph.json` and make them persistent."""

from __future__ import annotations

import contextlib
import importlib
import importlib.util
import inspect
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import StateGraph
from langgraph.pregel import Pregel

from .config import GraphSpec, LangGraphConfig

CHECKPOINT_PATH = Path(".radius") / "langgraph" / "checkpoints.sqlite"


class GraphLoadError(Exception):
    """Raised when a graph cannot be imported or resolved."""


@dataclass
class LoadedGraph:
    name: str
    graph: Pregel
    description: str | None = None


def prepare_import_path(config: LangGraphConfig) -> None:
    """Make the project and its local dependencies importable."""
    candidates = [config.root]
    for dep in config.dependencies:
        if dep.startswith((".", "/")):
            candidates.append((config.root / dep).resolve())
    for candidate in reversed(candidates):
        entry = str(candidate)
        if candidate.is_dir() and entry not in sys.path:
            sys.path.insert(0, entry)


def _package_module_name(file_path: Path) -> tuple[str, Path] | None:
    parts = [file_path.stem]
    directory = file_path.parent
    while (directory / "__init__.py").is_file():
        parts.insert(0, directory.name)
        directory = directory.parent
    if len(parts) == 1:
        return None
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts), directory


def _import_target(spec: str, root: Path) -> tuple[ModuleType, str]:
    module_ref, sep, attr = spec.rpartition(":")
    if not sep or not module_ref or not attr:
        raise GraphLoadError(f'"{spec}" must look like "path/to/file.py:attr" or "module:attr"')

    if module_ref.endswith(".py") or "/" in module_ref or "\\" in module_ref:
        file_path = (root / module_ref).resolve()
        if not file_path.is_file():
            raise GraphLoadError(f"graph file not found: {file_path}")
        package_module = _package_module_name(file_path)
        if package_module is not None:
            # Inside a package: import by dotted name so relative imports work.
            module_name, package_root = package_module
            if str(package_root) not in sys.path:
                sys.path.insert(0, str(package_root))
            return importlib.import_module(module_name), attr
        module_name = "_radius_langgraph_" + re.sub(r"\W", "_", file_path.stem)
        import_spec = importlib.util.spec_from_file_location(module_name, file_path)
        if import_spec is None or import_spec.loader is None:
            raise GraphLoadError(f"cannot import {file_path}")
        module = importlib.util.module_from_spec(import_spec)
        if str(file_path.parent) not in sys.path:
            sys.path.insert(0, str(file_path.parent))
        sys.modules[module_name] = module
        import_spec.loader.exec_module(module)
        return module, attr

    return importlib.import_module(module_ref), attr


def _factory_args(factory: Callable[..., Any], config: dict[str, Any]) -> list[Any]:
    try:
        signature = inspect.signature(factory)
    except (TypeError, ValueError):
        return []
    args: list[Any] = []
    for param in signature.parameters.values():
        if param.kind in (param.VAR_POSITIONAL, param.VAR_KEYWORD):
            continue
        annotation = str(param.annotation)
        if "ServerRuntime" in annotation or param.name == "runtime":
            raise GraphLoadError(
                "graph factories that take a LangGraph ServerRuntime are not supported; "
                "accept a RunnableConfig or no arguments instead"
            )
        if param.default is not param.empty:
            continue
        args.append(config)
    if len(args) > 1:
        raise GraphLoadError("graph factories may take at most one argument (a RunnableConfig)")
    return args


async def _resolve(value: Any, stack: contextlib.AsyncExitStack, depth: int = 0) -> Pregel:
    if depth > 4:
        raise GraphLoadError("graph factory did not produce a graph")
    if isinstance(value, Pregel):
        return value
    if isinstance(value, StateGraph):
        return value.compile()
    if inspect.isawaitable(value):
        return await _resolve(await value, stack, depth + 1)
    if hasattr(value, "__aenter__") and hasattr(value, "__aexit__"):
        return await _resolve(await stack.enter_async_context(value), stack, depth + 1)
    if hasattr(value, "__enter__") and hasattr(value, "__exit__"):
        return await _resolve(stack.enter_context(value), stack, depth + 1)
    if callable(value):
        factory_config: dict[str, Any] = {"configurable": {}}
        result = value(*_factory_args(value, factory_config))
        return await _resolve(result, stack, depth + 1)
    raise GraphLoadError(
        f"expected a compiled graph, a StateGraph, or a factory; got {type(value).__name__}"
    )


async def load_graph(spec: GraphSpec, root: Path, stack: contextlib.AsyncExitStack) -> LoadedGraph:
    try:
        module, attr = _import_target(spec.spec, root)
    except GraphLoadError:
        raise
    except Exception as exc:
        raise GraphLoadError(f"failed to import {spec.spec}: {exc!r}") from exc
    if not hasattr(module, attr):
        raise GraphLoadError(f'{spec.spec}: module "{module.__name__}" has no attribute "{attr}"')
    try:
        graph = await _resolve(getattr(module, attr), stack)
    except GraphLoadError:
        raise
    except Exception as exc:
        raise GraphLoadError(f"failed to build graph from {spec.spec}: {exc!r}") from exc
    return LoadedGraph(name=spec.name, graph=graph, description=spec.description)


def needs_checkpointer(graph: Pregel) -> bool:
    # `False` is an explicit opt-out; `True` (inherit) has nothing to inherit at the root.
    checkpointer = getattr(graph, "checkpointer", None)
    return checkpointer is None or checkpointer is True


async def attach_checkpointers(
    graphs: list[LoadedGraph],
    stack: contextlib.AsyncExitStack,
    cwd: Path,
) -> Path | None:
    """Give every graph without a checkpointer a shared SQLite one under `.radius/`."""
    missing = [loaded for loaded in graphs if needs_checkpointer(loaded.graph)]
    if not missing:
        return None
    db_path = cwd / CHECKPOINT_PATH
    db_path.parent.mkdir(parents=True, exist_ok=True)
    saver = await stack.enter_async_context(AsyncSqliteSaver.from_conn_string(str(db_path)))
    await saver.setup()
    for loaded in missing:
        loaded.graph.checkpointer = saver
    return db_path


async def load_graphs(
    config: LangGraphConfig,
    stack: contextlib.AsyncExitStack,
    *,
    only: str | None = None,
    cwd: Path | None = None,
) -> list[LoadedGraph]:
    specs = config.graphs
    if only is not None:
        specs = [spec for spec in specs if spec.name == only]
        if not specs:
            names = ", ".join(spec.name for spec in config.graphs)
            raise GraphLoadError(f'graph "{only}" is not defined in {config.path} ({names})')
    prepare_import_path(config)
    loaded = [await load_graph(spec, config.root, stack) for spec in specs]
    await attach_checkpointers(loaded, stack, cwd or Path.cwd())
    return loaded
