import contextlib
import os
from pathlib import Path

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from radius_langgraph.config import ConfigError, apply_env, load_config
from radius_langgraph.loader import GraphLoadError, load_graphs


async def test_graph_without_checkpointer_gets_sqlite(weather_project: Path) -> None:
    config = load_config(weather_project / "langgraph.json")
    async with contextlib.AsyncExitStack() as stack:
        (loaded,) = await load_graphs(config, stack, cwd=weather_project)
        assert loaded.name == "weather"
        assert isinstance(loaded.graph.checkpointer, AsyncSqliteSaver)
    assert (weather_project / ".radius" / "langgraph" / "checkpoints.sqlite").is_file()


async def test_existing_checkpointer_is_kept_and_factories_resolve(multi_project: Path) -> None:
    config = load_config(multi_project / "langgraph.json")
    async with contextlib.AsyncExitStack() as stack:
        graphs = {g.name: g for g in await load_graphs(config, stack, cwd=multi_project)}
        assert isinstance(graphs["remembered"].graph.checkpointer, InMemorySaver)
        assert isinstance(graphs["echo"].graph.checkpointer, AsyncSqliteSaver)
        assert graphs["echo"].graph.checkpointer is graphs["shout"].graph.checkpointer


async def test_unknown_graph_name_is_rejected(multi_project: Path) -> None:
    config = load_config(multi_project / "langgraph.json")
    async with contextlib.AsyncExitStack() as stack:
        with pytest.raises(GraphLoadError, match='graph "nope"'):
            await load_graphs(config, stack, only="nope", cwd=multi_project)


def test_config_requires_graphs(tmp_path: Path) -> None:
    path = tmp_path / "langgraph.json"
    path.write_text('{"graphs": {}}')
    with pytest.raises(ConfigError, match="non-empty"):
        load_config(path)


def test_env_file_is_loaded_without_overriding(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / ".env").write_text('# comment\nexport RL_A="one"\nRL_B=two\n')
    (tmp_path / "langgraph.json").write_text('{"graphs": {"g": "x:y"}, "env": ".env"}')
    monkeypatch.delenv("RL_A", raising=False)
    monkeypatch.setenv("RL_B", "kept")
    apply_env(load_config(tmp_path / "langgraph.json"))
    assert os.environ["RL_A"] == "one"
    assert os.environ["RL_B"] == "kept"
    monkeypatch.delenv("RL_A")
