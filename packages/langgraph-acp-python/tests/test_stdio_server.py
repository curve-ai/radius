"""Drive `radius-langgraph` over real stdio with raw JSON-RPC."""

import asyncio
import json
from pathlib import Path
from typing import Any

from acp_client import AcpProcess


def _prompt(session_id: str, text: str) -> dict[str, Any]:
    return {"sessionId": session_id, "prompt": [{"type": "text", "text": text}]}


async def _new_session(client: AcpProcess, cwd: Path) -> dict[str, Any]:
    return await client.request("session/new", {"cwd": str(cwd), "mcpServers": []})


async def test_prompt_streams_text_tools_and_history(weather_project: Path) -> None:
    client = await AcpProcess.start(weather_project)
    init = await client.initialize()
    assert init["protocolVersion"] == 1
    assert init["agentInfo"]["name"] == "radius-langgraph"
    assert init["agentCapabilities"]["loadSession"] is True

    session = await _new_session(client, weather_project)
    sid = session["sessionId"]
    assert session["modes"]["currentModeId"] == "weather"
    assert [m["id"] for m in session["modes"]["availableModes"]] == ["weather"]

    result = await client.request("session/prompt", _prompt(sid, "hello there"))
    assert result["stopReason"] == "end_turn"
    chunks = client.updates(sid, "agent_message_chunk")
    assert len(chunks) > 1, "text should stream as several chunks"
    assert client.agent_text(sid) == "You have said 1 things: hello there"

    client.clear()
    result = await client.request("session/prompt", _prompt(sid, "what is the weather?"))
    assert result["stopReason"] == "end_turn"
    (started,) = client.updates(sid, "tool_call")
    assert started["title"] == "get_weather"
    assert started["status"] == "in_progress"
    assert started["rawInput"] == {"city": "Paris"}
    (finished,) = client.updates(sid, "tool_call_update")
    assert finished["toolCallId"] == started["toolCallId"]
    assert finished["status"] == "completed"
    assert finished["content"][0]["content"]["text"] == "Sunny in Paris"
    assert client.agent_text(sid) == "Tool said: Sunny in Paris"

    client.clear()
    await client.request("session/prompt", _prompt(sid, "remember me"))
    assert client.agent_text(sid) == (
        "You have said 3 things: hello there | what is the weather? | remember me"
    )

    code, stderr = await client.close()
    assert client.bad_lines == [], "stdout must carry only JSON-RPC"
    assert all(json.loads(line)["jsonrpc"] == "2.0" for line in client.stdout_lines)
    assert "weather graph module loaded" in stderr
    assert "agent node running" in stderr
    assert "looking up weather for Paris" in stderr
    assert code == 0
    assert (weather_project / ".radius" / "langgraph" / "checkpoints.sqlite").is_file()


async def test_cancel_stops_running_turn(weather_project: Path) -> None:
    client = await AcpProcess.start(weather_project)
    await client.initialize()
    sid = (await _new_session(client, weather_project))["sessionId"]

    prompt = asyncio.create_task(client.request("session/prompt", _prompt(sid, "go slow")))
    await client.wait_for_update(sid, "tool_call")
    await client.notify("session/cancel", {"sessionId": sid})
    result = await asyncio.wait_for(prompt, 10)
    assert result["stopReason"] == "cancelled"
    assert client.updates(sid, "tool_call_update")[-1]["status"] == "failed"

    client.clear()
    result = await client.request("session/prompt", _prompt(sid, "still there?"))
    assert result["stopReason"] == "end_turn"
    assert client.agent_text(sid) == "You have said 2 things: go slow | still there?"
    await client.close()
    assert client.bad_lines == []


async def test_interrupt_asks_permission_and_resumes(weather_project: Path) -> None:
    client = await AcpProcess.start(weather_project)
    await client.initialize()
    sid = (await _new_session(client, weather_project))["sessionId"]

    result = await client.request("session/prompt", _prompt(sid, "please deploy"))
    assert result["stopReason"] == "end_turn"
    (request,) = client.permission_requests
    assert request["toolCall"]["title"] == "Deploy to production?"
    assert {o["optionId"] for o in request["options"]} == {"approve", "reject"}
    (started,) = client.updates(sid, "tool_call")
    assert request["toolCall"]["toolCallId"] == started["toolCallId"]
    assert client.updates(sid, "tool_call_update")[-1]["content"][0]["content"]["text"] == (
        "deployed"
    )
    assert client.agent_text(sid) == "Tool said: deployed"
    await client.close()


async def test_interrupt_falls_back_to_text_reply(weather_project: Path) -> None:
    client = await AcpProcess.start(weather_project)
    client.on_permission = lambda params: {"outcome": {"outcome": "cancelled"}}
    await client.initialize()
    sid = (await _new_session(client, weather_project))["sessionId"]

    result = await client.request("session/prompt", _prompt(sid, "deploy now"))
    assert result["stopReason"] == "cancelled"

    client.clear()
    result = await client.request("session/prompt", _prompt(sid, "yes"))
    assert result["stopReason"] == "end_turn"
    assert client.agent_text(sid) == "Tool said: deployed"
    await client.close()


async def test_session_load_reuses_thread_across_processes(weather_project: Path) -> None:
    first = await AcpProcess.start(weather_project)
    await first.initialize()
    sid = (await _new_session(first, weather_project))["sessionId"]
    await first.request("session/prompt", _prompt(sid, "first message"))
    await first.close()

    second = await AcpProcess.start(weather_project)
    await second.initialize()
    loaded = await second.request(
        "session/load", {"sessionId": sid, "cwd": str(weather_project), "mcpServers": []}
    )
    assert loaded["modes"]["currentModeId"] == "weather"
    replayed = second.updates(sid, "user_message_chunk")
    assert [u["content"]["text"] for u in replayed] == ["first message"]
    assert second.agent_text(sid) == "You have said 1 things: first message"

    second.clear()
    await second.request("session/prompt", _prompt(sid, "second message"))
    assert second.agent_text(sid) == "You have said 2 things: first message | second message"
    await second.close()


async def test_multiple_graphs_are_session_modes(multi_project: Path) -> None:
    client = await AcpProcess.start(multi_project)
    await client.initialize()
    session = await _new_session(client, multi_project)
    sid = session["sessionId"]
    modes = session["modes"]
    assert modes["currentModeId"] == "echo"
    assert [m["id"] for m in modes["availableModes"]] == ["echo", "shout", "remembered"]
    assert modes["availableModes"][1]["description"] == "Shouts back"

    await client.request("session/prompt", _prompt(sid, "hi"))
    assert client.agent_text(sid) == "echo: hi"

    client.clear()
    await client.request("session/set_mode", {"sessionId": sid, "modeId": "shout"})
    await client.request("session/prompt", _prompt(sid, "hi"))
    assert client.agent_text(sid) == "HI"

    client.clear()
    await client.request("session/set_mode", {"sessionId": sid, "modeId": "remembered"})
    await client.request("session/prompt", _prompt(sid, "keep this"))
    assert client.agent_text(sid) == "noted"
    await client.close()


async def test_graph_flag_serves_one_graph(multi_project: Path) -> None:
    client = await AcpProcess.start(multi_project, "--graph", "shout")
    await client.initialize()
    modes = (await _new_session(client, multi_project))["modes"]
    assert [m["id"] for m in modes["availableModes"]] == ["shout"]
    await client.close()


async def test_load_error_exits_before_serving(tmp_path: Path) -> None:
    (tmp_path / "agent.py").write_text("graph = None\n")
    (tmp_path / "langgraph.json").write_text('{"graphs": {"broken": "./agent.py:missing"}}')
    client = await AcpProcess.start(tmp_path)
    code, stderr = await client.close()
    assert code != 0
    assert 'has no attribute "missing"' in stderr
    assert client.stdout_lines == []


async def test_missing_config_exits_with_message(tmp_path: Path) -> None:
    client = await AcpProcess.start(tmp_path, "--config", "nope/langgraph.json")
    code, stderr = await client.close()
    assert code != 0
    assert "LangGraph config not found" in stderr
