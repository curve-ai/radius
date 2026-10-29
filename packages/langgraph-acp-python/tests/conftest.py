import shutil
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


def _copy_fixture(name: str, tmp_path: Path) -> Path:
    target = tmp_path / name
    shutil.copytree(FIXTURES / name, target, ignore=shutil.ignore_patterns("__pycache__"))
    return target


@pytest.fixture
def weather_project(tmp_path: Path) -> Path:
    return _copy_fixture("weather", tmp_path)


@pytest.fixture
def multi_project(tmp_path: Path) -> Path:
    return _copy_fixture("multi", tmp_path)
