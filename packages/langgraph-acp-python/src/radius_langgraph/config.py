"""Read `langgraph.json` the way the LangGraph CLI does."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class ConfigError(Exception):
    """Raised when `langgraph.json` is missing or malformed."""


@dataclass(frozen=True)
class GraphSpec:
    name: str
    spec: str
    description: str | None = None


@dataclass(frozen=True)
class LangGraphConfig:
    path: Path
    graphs: list[GraphSpec]
    dependencies: list[str] = field(default_factory=list)
    env: dict[str, str] | str | None = None

    @property
    def root(self) -> Path:
        return self.path.parent


def load_config(path: Path) -> LangGraphConfig:
    if not path.is_file():
        raise ConfigError(f"LangGraph config not found: {path}")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ConfigError(f"{path} is not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise ConfigError(f"{path} must contain a JSON object")

    graphs_raw = raw.get("graphs")
    if not isinstance(graphs_raw, dict) or not graphs_raw:
        raise ConfigError(f'{path} must define a non-empty "graphs" object')

    graphs: list[GraphSpec] = []
    for name, value in graphs_raw.items():
        if isinstance(value, str):
            graphs.append(GraphSpec(name=name, spec=value))
        elif isinstance(value, dict) and isinstance(value.get("path"), str):
            description = value.get("description")
            graphs.append(
                GraphSpec(
                    name=name,
                    spec=value["path"],
                    description=description if isinstance(description, str) else None,
                )
            )
        else:
            raise ConfigError(
                f'graph "{name}" in {path} must be "path/to/file.py:attr", "module:attr", '
                'or an object with a "path" field'
            )

    dependencies = raw.get("dependencies") or []
    if not isinstance(dependencies, list):
        raise ConfigError(f'"dependencies" in {path} must be a list')

    env = raw.get("env")
    if env is not None and not isinstance(env, dict | str):
        raise ConfigError(f'"env" in {path} must be an object or a path to a .env file')

    return LangGraphConfig(
        path=path.resolve(),
        graphs=graphs,
        dependencies=[str(dep) for dep in dependencies],
        env=env,
    )


def apply_env(config: LangGraphConfig) -> None:
    """Load `env` into the process environment without overriding existing values."""
    if config.env is None:
        return
    if isinstance(config.env, dict):
        values: dict[str, Any] = config.env
    else:
        env_path = (config.root / config.env).resolve()
        if not env_path.is_file():
            raise ConfigError(f"env file not found: {env_path}")
        values = _parse_dotenv(env_path.read_text(encoding="utf-8"))
    for key, value in values.items():
        os.environ.setdefault(str(key), str(value))


def _parse_dotenv(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        line = line.removeprefix("export ").strip()
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values
