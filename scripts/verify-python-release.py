from __future__ import annotations

import hashlib
import os
import subprocess
import tempfile
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PROJECT = ROOT / "sdks" / "python"
EXPECTED_WHEEL = "radius_agent_sdk-0.0.1-py3-none-any.whl"


def run(*args: str, cwd: Path = ROOT, env: dict[str, str] | None = None) -> None:
    subprocess.run(args, cwd=cwd, env=env, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


with tempfile.TemporaryDirectory(prefix="radius-python-release-") as temporary:
    temp = Path(temporary)
    first = temp / "first"
    second = temp / "second"
    environment = os.environ.copy()
    environment["SOURCE_DATE_EPOCH"] = "315532800"
    environment["UV_DEFAULT_INDEX"] = "https://pypi.org/simple"
    for key in list(environment):
        if key.startswith("UV_INDEX") and key != "UV_DEFAULT_INDEX":
            environment.pop(key)

    run("uv", "build", "--wheel", "--project", str(PROJECT), "--out-dir", str(first), env=environment)
    run("uv", "build", "--wheel", "--project", str(PROJECT), "--out-dir", str(second), env=environment)
    first_wheel = first / EXPECTED_WHEEL
    second_wheel = second / EXPECTED_WHEEL
    first_digest = digest(first_wheel)
    if first_digest != digest(second_wheel):
        raise SystemExit("Python SDK wheel is not deterministic")

    with zipfile.ZipFile(first_wheel) as archive:
        names = archive.namelist()
        if any("/tests/" in name or "__pycache__" in name for name in names):
            raise SystemExit("Python SDK wheel contains test or cache files")
        license_names = [name for name in names if name.endswith(".dist-info/licenses/LICENSE")]
        if len(license_names) != 1:
            raise SystemExit("Python SDK wheel must contain exactly one MIT license file")
        metadata_name = next(name for name in names if name.endswith(".dist-info/METADATA"))
        metadata = archive.read(metadata_name).decode()
        for expected in (
            "Name: radius-agent-sdk",
            "Version: 0.0.1",
            "Requires-Python: <3.15,>=3.10",
            "Requires-Dist: agent-client-protocol==0.12.1",
        ):
            if expected not in metadata:
                raise SystemExit(f"Python SDK metadata is missing {expected}")

    venv = temp / "venv"
    run("uv", "venv", "--python", "3.12", str(venv), env=environment)
    python = venv / "bin" / "python"
    run("uv", "pip", "install", "--python", str(python), str(first_wheel), env=environment)
    run(
        str(python),
        "-c",
        "from radius_agent_sdk import define_agent; "
        "agent = define_agent(name='external-smoke', run=lambda context: 'ok'); "
        "assert agent is not None",
        env=environment,
    )

    print(f"Verified radius-agent-sdk@0.0.1\t{first_digest}\t{first_wheel.stat().st_size}")
