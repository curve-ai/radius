# radius-langgraph

Serves the graphs of a LangGraph project over the
[Agent Client Protocol](https://agentclientprotocol.com) (ACP) on stdio. The
project needs no ACP code: the adapter reads `langgraph.json`, loads each graph,
and translates ACP requests into LangGraph runs.

## Usage

Run it inside the project's environment, so the graph's own dependencies are
importable, from a directory that contains `langgraph.json`:

```sh
uv run --with /path/to/radius-langgraph radius-langgraph
uv run --with /path/to/radius-langgraph radius-langgraph --config path/to/langgraph.json --graph agent
```

If `radius-langgraph` is already a project dependency, `uv run radius-langgraph`
is enough.

`langgraph.json` follows the LangGraph CLI format:

```json
{
  "dependencies": ["."],
  "graphs": { "agent": "./src/agent/graph.py:graph" },
  "env": ".env"
}
```

A graph reference is `path/to/file.py:attr` or `module.path:attr`. The attribute
may be a compiled graph, an uncompiled `StateGraph`, or a factory (sync or async,
taking no arguments or a `RunnableConfig`, optionally returning a context
manager). Factories are called once at startup. `env` may be an object or a path
to a `.env` file; existing environment variables win.

## Use with Radius

`radius init` in a directory with a Python `langgraph.json` writes a
`radius.json` with `"runtime": { "kind": "langgraph" }`. `radius dev` and
`radius check` then start this adapter for you with
`uv run --with radius-langgraph==0.0.1 radius-langgraph`; the project does not
depend on it.

The package is not on PyPI yet, so point Radius at a checkout instead:

```sh
RADIUS_LANGGRAPH_ADAPTER=/path/to/radius/packages/langgraph-acp-python radius check
```

The variable overrides `runtime.adapter`, and takes a path or any uv
requirement. `radius build` cannot package a langgraph runtime yet.

## Protocol mapping

| ACP                   | LangGraph                                                                    |
| --------------------- | ---------------------------------------------------------------------------- |
| `session/new`         | new `thread_id`; each graph is a session mode (id = graph name)              |
| `session/set_mode`    | switch the graph used by the session                                         |
| `session/load`        | reuse the stored thread and replay its messages                              |
| `session/prompt`      | `astream({"messages": [HumanMessage]}, stream_mode=["messages", "updates"])` |
| `session/cancel`      | cancel the running stream; stop reason `cancelled`                           |
| `agent_message_chunk` | AI message tokens (reasoning blocks become `agent_thought_chunk`)            |
| `tool_call` / update  | AI tool calls / `ToolMessage` results (`status="error"` is `failed`)         |

With several graphs, each graph keeps its own thread per session
(`<sessionId>:<graph>`); with one graph the thread id is the session id.

Graphs must use a `messages` state key that accepts LangChain messages, as
`MessagesState` and `create_agent` do.

### Persistence

A graph compiled without a checkpointer gets a shared SQLite checkpointer at
`.radius/langgraph/checkpoints.sqlite` in the working directory, so a session can
be loaded by a later process. A graph that already has a checkpointer keeps it;
`checkpointer=False` is left disabled.

### Interrupts

When a run stops on `interrupt(value)`, the adapter sends
`session/request_permission` and resumes with `Command(resume=...)`:

- Default options are Approve and Reject, resuming with `True` or `False`.
- If `value` is a dict with an `options` list of strings, those become the
  options and the chosen string is the resume value.
- LangChain human-in-the-loop requests (`action_requests`) resume with
  `{"decisions": [{"type": "approve" | "reject"}, ...]}`.

If the client cancels the permission request, the turn ends with `cancelled`
and the interrupt stays pending. If the client cannot answer permission
requests, the adapter describes the interrupt in a message instead. Either
way, the next prompt answers the interrupt: its text is the resume value
(matched against `options` when present; `yes`/`approve` approves a
human-in-the-loop request, anything else rejects it with the text as the
message).

### stdout

stdout carries only ACP messages. Before user code is imported, file
descriptor 1 is pointed at stderr, so `print()`, logging, native extensions,
and child processes write to stderr.

## Limitations

- macOS and Linux only.
- Text and embedded text resources are accepted as prompt input; images and
  audio are not.
- Factories that take a LangGraph server `ServerRuntime` are not supported.
- Only top-level graph tool calls are reported; subgraph tool calls are not.

## Development

```sh
uv sync
uv run pytest
uv run ruff check . && uv run ruff format --check .
```
