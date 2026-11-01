# @curve-ai/radius-langgraph

Serves the graphs of a LangGraph.js project over the
[Agent Client Protocol](https://agentclientprotocol.com) (ACP) on stdio. The
project needs no ACP code: the adapter reads `langgraph.json`, loads each graph,
and translates ACP requests into LangGraph runs.

This is the JavaScript counterpart of
[`radius-langgraph`](../langgraph-acp-python) for Python graphs, and maps ACP
to LangGraph the same way.

## Usage

Run it from a directory that contains `langgraph.json`, in a project that has
`@langchain/langgraph` and `@langchain/core` installed:

```sh
node /path/to/radius/packages/langgraph-acp-typescript/bin/radius-langgraph.mjs
node /path/to/radius/packages/langgraph-acp-typescript/bin/radius-langgraph.mjs --config path/to/langgraph.json --graph agent
```

`langgraph.json` follows the LangGraph CLI format:

```json
{
  "node_version": "22",
  "graphs": { "agent": "./src/agent.ts:graph" },
  "env": ".env"
}
```

A graph reference is `./path/to/file.ts:export`, as the LangGraph JS server
reads it: the file is resolved against `langgraph.json`, may be `.ts`, `.mts`,
`.js` or `.mjs`, and the export defaults to `default` when there is no colon.
TypeScript files load through tsx, so the project needs no build step. The
export may be a compiled graph, an uncompiled `StateGraph`, a `createAgent` or
`createDeepAgent` agent, a promise of any of those, or a factory (sync or
async, taking no arguments or a `RunnableConfig`). Factories are called once at
startup. `env` may be an object or a path to a `.env` file; existing
environment variables win.

The adapter imports `@langchain/langgraph` and `@langchain/core` from the
project, never its own copy: they are peer dependencies, so the `Command`s and
messages it creates are the same classes the graph was built with.

## Use with Radius

`radius init` in a directory with a JavaScript or TypeScript `langgraph.json`
writes a `radius.json` with
`"runtime": { "kind": "langgraph", "language": "typescript" }`. `radius dev`
and `radius check` then start this adapter for you with
`npx --yes @curve-ai/radius-langgraph@0.0.1`; the project does not depend on
it.

The package is not on npm yet, so point Radius at a checkout instead:

```sh
RADIUS_LANGGRAPH_ADAPTER=/path/to/radius/packages/langgraph-acp-typescript radius check
```

The checkout needs its dependencies installed (`bun install` at the root).
`radius build` cannot package a langgraph runtime yet.

## Protocol mapping

| ACP                   | LangGraph                                                                       |
| --------------------- | ------------------------------------------------------------------------------- |
| `session/new`         | new `thread_id`; each graph is a session mode (id = graph name)                 |
| `session/set_mode`    | switch the graph used by the session                                            |
| `session/load`        | reuse the stored thread and replay its messages                                 |
| `session/prompt`      | `stream({ messages: [HumanMessage] }, { streamMode: ["messages", "updates"] })` |
| `session/cancel`      | abort the running stream; stop reason `cancelled`                               |
| `agent_message_chunk` | AI message tokens (reasoning blocks become `agent_thought_chunk`)               |
| `tool_call` / update  | AI tool calls / `ToolMessage` results (`status: "error"` is `failed`)           |

With several graphs, each graph keeps its own thread per session
(`<sessionId>:<graph>`); with one graph the thread id is the session id.

Graphs must use a `messages` state key that accepts LangChain messages, as
`MessagesAnnotation` and `createAgent` do.

### Persistence

A graph compiled without a checkpointer gets a shared SQLite checkpointer
(`@langchain/langgraph-checkpoint-sqlite`) at
`.radius/langgraph/checkpoints.sqlite` in the working directory, so a session
can be loaded by a later process. A graph that already has a checkpointer keeps
it; `checkpointer: false` is left disabled.

The SQLite saver needs `better-sqlite3`'s native build. If it cannot be loaded,
the adapter warns on stderr and uses the project's `MemorySaver` instead:
everything works except loading a session in a new process.

### Interrupts

When a run stops on `interrupt(value)`, the adapter sends
`session/request_permission` and resumes with `new Command({ resume })`:

- Default options are Approve and Reject, resuming with `true` or `false`.
- If `value` is an object with an `options` array of strings, those become the
  options and the chosen string is the resume value.
- LangChain human-in-the-loop requests (`actionRequests`) resume with
  `{ decisions: [{ type: "approve" | "reject" }, ...] }`.

If the client cancels the permission request, the turn ends with `cancelled`
and the interrupt stays pending. If the client cannot answer permission
requests, the adapter describes the interrupt in a message instead. Either
way, the next prompt answers the interrupt: its text is the resume value
(matched against `options` when present; `yes`/`approve` approves a
human-in-the-loop request, anything else rejects it with the text as the
message).

### stdout

stdout carries only ACP messages. Before user code is imported,
`process.stdout.write` is pointed at stderr, so `console.log` and anything
else writing through `process.stdout` goes to stderr. Node cannot repoint file
descriptor 1 itself, so a child process spawned with `stdio: "inherit"` is not
covered.

## Limitations

- Text and embedded text resources are accepted as prompt input; images and
  audio are not.
- Factories that take the LangGraph server's runtime argument are not
  supported.
- Only top-level graph tool calls are reported; subgraph tool calls are not.

## Development

```sh
bun install
bun run --cwd packages/langgraph-acp-typescript test
bun run --cwd packages/langgraph-acp-typescript typecheck
```
