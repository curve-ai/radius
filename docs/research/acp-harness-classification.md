# CUR-37 — Which agent harnesses speak ACP, and what an adapter costs

Desk research. Nothing was installed or executed. Every claim is sourced to a
primary source: the ACP spec site, the vendored `@agentclientprotocol/sdk`
package in this repo's `node_modules`, or Radius source.

Date: 2026-09-06. Repo state: branch `piyushagwl007/check-main-sync`, head `4e6e762`.

---

## Headline

**The loopback-WebSocket assumption in PR #14 is half right, and the half that
is wrong is the half the map depends on.**

- WebSocket is **not** a transport the ACP specification defines. The spec's
  Transports page names exactly three things: **stdio** (Defined), **Streamable
  HTTP** (Draft, "in discussion"), and **Custom** (Optional). WebSocket is not
  mentioned at all.
- WebSocket *is* shipped in the official TypeScript SDK — but only under an
  `experimental/` export path, alongside an experimental HTTP client and an
  experimental v2 draft.
- Critically, no third-party harness listens on a WebSocket. Every ACP client
  in the published ecosystem launches the agent as a **subprocess** and speaks
  newline-delimited JSON-RPC over its stdin/stdout.

So `ws://127.0.0.1:7331/acp` is not a Radius invention of the *wire format* —
it is a Radius bet on an **experimental SDK transport that only a Radius-SDK
agent can serve**. For `runtime.kind: "command"` (the "bring your own agent"
product), the loopback WebSocket endpoint is unreachable: the harness has no
WebSocket server to point at. That is the finding that reshapes `radius dev`.

---

## Half one — pinning down ACP

### Identity — confirmed, with a name collision to be aware of

ACP here is the **Agent Client Protocol**, authored by **Zed Industries**.

- Spec site: <https://agentclientprotocol.com>
- TypeScript SDK: `@agentclientprotocol/sdk`, `"author": "Zed Industries"`,
  `"license": "Apache-2.0"`, repo `github.com/agentclientprotocol/typescript-sdk`
  (verified in `node_modules/@agentclientprotocol/sdk/package.json`).
- SDK README banner links `zed.dev/img/acp/banner-dark.webp`.

Self-description from the vendored package.json:

> The Agent Client Protocol (ACP) is a protocol that standardizes communication
> between *code editors* (interactive programs for viewing and editing source
> code) and *coding agents* (programs that use generative AI to autonomously
> modify code).

Note the project has moved out of the `zed-industries` GitHub org into its own
`agentclientprotocol` org, with a governance/working-group structure
(<https://agentclientprotocol.com/llms.txt> lists Governance, Working and
Interest Groups, Contributor Communication). The npm scope moved with it:
`@agentclientprotocol/sdk`, not `@zed-industries/agent-client-protocol`.

**Collision warning.** "ACP" is also the *Agent Communication Protocol* (IBM /
BeeAI, `agentcommunicationprotocol.dev`) — a REST/HTTP agent-to-agent protocol,
a completely different thing in the A2A family. Search results for "ACP" mix
the two freely. When writing Radius docs, say "Agent Client Protocol (ACP)" on
first use and link the spec, or readers will land in the wrong protocol.

### Transport — the crux

The spec's Transports page (<https://agentclientprotocol.com/protocol/transports>)
defines exactly:

| Transport | Status | Key requirement |
|---|---|---|
| stdio | **Defined** | "Agents and clients **SHOULD** support stdio whenever possible" |
| Streamable HTTP | **Draft** | "In discussion, draft proposal in progress" |
| Custom | Optional | "**MUST** ensure they preserve the JSON-RPC message format and lifecycle requirements defined by ACP" |

stdio details, quoted:

> The client launches the agent as a subprocess. The agent reads JSON-RPC
> messages from its standard input (`stdin`) and sends messages to its standard
> output (`stdout`).
>
> Messages are delimited by newlines (`\n`), and **MUST NOT** contain embedded
> newlines.
>
> The agent **MUST NOT** write anything to its `stdout` that is not a valid ACP
> message.

The Overview page (<https://agentclientprotocol.com/protocol/overview>) reinforces
this in the role definitions: agents "typically run as **subprocesses** of the
Client."

**WebSocket appears nowhere in the spec.** It exists only in the SDK. From the
vendored `@agentclientprotocol/sdk@1.4.0` `package.json` `exports`:

```json
".":                        "./dist/acp.js",
"./experimental/v2":        "./dist/v2/acp.js",
"./experimental/http-client": "./dist/http-stream.js",
"./experimental/ws-client":   "./dist/ws-stream.js",
"./experimental/server":      "./dist/server.js",
"./experimental/node":        "./dist/node-adapter.js"
```

Every non-stdio transport sits behind `experimental/`. The SDK's own v2 warning
sets the tone for that namespace:

> **Warning:** ACP v2 is still a draft. Its wire protocol and this TypeScript
> API may change incompatibly in any SDK release.

`dist/ws-stream.d.ts` documents `createWebSocketStream(serverUrl, options)` —
"Creates an ACP Stream over WebSocket. Sends and receives ACP JSON-RPC messages
as WebSocket text frames." It supports subprotocols, headers (Node `ws` only —
"Browser WebSocket constructors ignore custom headers"), and a cookie store for
affinity across reconnects. `dist/server.d.ts` provides `AcpServer`, an "ACP
server transport for Streamable HTTP and WebSocket connections", with
`prepareWebSocketUpgrade` / `handleRequest`.

A live datapoint on how the ecosystem reads this: opencode has an **open**
feature request, [anomalyco/opencode#13388 "ACP over WebSocket for
remote/network access"](https://github.com/anomalyco/opencode/issues/13388),
asking for a `/acp` WebSocket endpoint and an `opencode acp-websocket` command,
explicitly because today ACP is reachable "not only via stdio" is *not* true —
stdio is all there is. No maintainer response, no linked PR.

**Verdict.** Loopback WebSocket is a legitimate *custom transport* under the
spec's escape hatch, and the official SDK has code for it — so PR #14 is not
inventing a wire format. But it is not idiomatic, it is not what any harness
implements, and it is not stable API. Anything Radius builds on it is a
Radius-SDK-only path.

### Handshake and capability negotiation

`PROTOCOL_VERSION = 1` (`dist/schema/index.js:51`). It is "a single integer that
identifies a MAJOR protocol version", incremented only for breaking changes.

- Client sends `initialize` with `protocolVersion`, `clientCapabilities`, optional
  `clientInfo`.
- Agent replies with `protocolVersion` (its own latest if it cannot match the
  client's), `agentCapabilities`, `agentInfo`, `authMethods`.
- Mismatch rule: "If the Client does not support the version specified by the
  Agent in the `initialize` response, the Client **SHOULD** close the connection
  and inform the user about it."

Client capabilities: `fs.readTextFile`, `fs.writeTextFile`, `terminal`.
Agent capabilities: `loadSession`, `promptCapabilities` (`image`, `audio`,
`embeddedContext`).

Full method surface, read straight out of `dist/schema/index.js`:

`AGENT_METHODS` (client → agent): `initialize`, `authenticate`, `providers/list`,
`providers/set`, `providers/disable`, `session/new`, `session/load`,
`session/set_mode`, `session/set_config_option`, `session/prompt`,
`session/cancel`, `mcp/message`, `session/list`, `session/delete`,
`session/fork`, `session/resume`, `session/close`, `logout`, `nes/start`,
`nes/suggest`, `nes/accept`, `nes/reject`, `nes/close`, `document/didOpen`,
`document/didChange`, `document/didClose`, `document/didSave`,
`document/didFocus`.

`CLIENT_METHODS` (agent → client): `session/request_permission`,
`session/update`, `fs/write_text_file`, `fs/read_text_file`, `terminal/create`,
`terminal/output`, `terminal/release`, `terminal/wait_for_exit`,
`terminal/kill`, `mcp/connect`, `mcp/message`, `mcp/disconnect`,
`elicitation/create`, `elicitation/complete`.

### Session and streaming model

`session/new` takes `cwd` plus `mcpServers`, and returns a `sessionId` and
`configOptions`. `session/prompt` runs a turn; the agent streams
`session/update` notifications until the prompt resolves with a `stopReason`.

`sessionUpdate` variants, extracted from the vendored `schema/schema.json`:

`agent_message_chunk`, `agent_thought_chunk`, `available_commands_update`,
`compaction_summary_chunk`, `compaction_update`, `config_option_update`,
`current_mode_update`, `plan`, `plan_removed`, `plan_update`,
`session_info_update`, `tool_call`, `tool_call_update`, `usage_update`,
`user_message_chunk`.

`StopReason`: `end_turn`, `max_tokens`, `max_turn_requests`, `refusal`,
`cancelled`. The schema is emphatic about the last one — "This stop reason MUST
be returned when the client sends a `session/cancel` notification, even if the
cancellation causes exceptions in underlying operations."

`session/cancel` is a **notification**, not a request. `session/load` requires
`agentCapabilities.loadSession`.

### Authentication

- Agents advertise options in `authMethods` on the `initialize` response.
- The client calls `authenticate` with a chosen method ID.
- An unauthenticated `session/new` fails with an `auth_required` error, which is
  the client's cue to run an advertised flow.
- There is a `logout` method, and `auth.terminal` is a client capability letting
  an agent drive a terminal-based login.

### Relationship to MCP

ACP reuses MCP content-block shapes for prompt and update content, and
`session/new` carries an `mcpServers` array so the client tells the agent which
MCP servers to connect. There is also MCP-over-ACP tunnelling
(`mcp/connect`, `mcp/message`, `mcp/disconnect` on the client side; `mcp/message`
on the agent side) and an MCP-over-ACP RFD in the spec index.

### Reconnect semantics (relevant to `radius dev`)

From `dist/ws-stream.d.ts`, verbatim:

> ACP v1 reconnect creates a new transport connection; callers should save the
> ACP `sessionId`, create a new stream with the same auth headers/cookie store,
> call `initialize`, verify `agentCapabilities.loadSession`, then call
> `session/load`. Agents must authorize `session/load`, and ACP v1 does not
> replay in-flight transport messages emitted while disconnected.

Radius does none of this. It opens a fresh connection and a fresh session per
run (see below), which is a defensible simplification but means an agent restart
mid-turn loses the turn.

---

## What Radius actually implements today

Two transports, two entirely different lifecycles, selected by whether a
development registration file exists.

| | Production path | Development path |
|---|---|---|
| Selector | no dev registration | dev registration present for the agent id |
| Transport | **stdio** | **loopback WebSocket** |
| Who owns the process | Radius (spawns runtime host) | the developer |
| Sandbox | microVM (OCI image, Linux/arm64) | **none** |
| Code | `packages/runtime/src/microvm.ts`, `stdio.ts` | `packages/runtime/src/websocket.ts`, `apps/desktop/src/main/agent-runtime.ts:1897` |

Files:

- `/Users/just_keep_debugging/orca/workspaces/radius/aspidochelone/packages/runtime/src/session.ts`
  — the ACP client. `client({name})`, registers handlers for
  `session/request_permission`, `fs/read_text_file`, `fs/write_text_file`, and
  all five `terminal/*` methods, then `initialize` → `session/new` → `prompt`.
- `.../packages/runtime/src/stdio.ts` — `ndJsonStream(child.stdin, child.stdout)`.
  Textbook idiomatic ACP.
- `.../packages/runtime/src/websocket.ts` — 15 lines, wraps
  `createWebSocketStream` from `@agentclientprotocol/sdk/experimental/ws-client`
  with the Node `ws` constructor and an optional `Authorization` header.
- `.../packages/runtime/src/development.ts` — `DevelopmentAgentConnectionSchema`.
  Enforces `ws:`/`wss:` and a loopback hostname
  (`localhost`, `127.0.0.1`, `[::1]`, `::1`).
- `.../packages/agent-contracts/src/index.ts` — the config/manifest contracts.
- `.../packages/sdk/src/development.ts` — the **server** side, using
  `@agentclientprotocol/sdk/experimental/server` (`AcpServer`) plus
  `experimental/node` HTTP and WS-upgrade handlers. Binds 127.0.0.1:7331/acp,
  refuses non-loopback hosts, optional bearer check.
- `.../packages/cli/src/dev.ts` — writes a 0600 JSON registration under the
  Radius user-data dir and shells the desktop app. It never starts an agent.
- `.../packages/cli/src/init.ts` — scaffolds.

### The dialect Radius speaks, versus upstream

**Aligned.** JSON-RPC framing via the official SDK; `PROTOCOL_VERSION` constant;
correct client-capability advertisement derived from the handlers actually
supplied; the full `fs/*` and `terminal/*` client surface; `session/cancel` as a
notification; MCP servers passed on `session/new`; `session_info_update` consumed
for session titles.

**Divergences worth recording:**

1. **The `initialize` response is discarded.** `session.ts` does
   `await connection.agent.request(methods.agent.initialize, {...})` and throws
   the result away. Radius therefore never checks `protocolVersion` (so the spec's
   SHOULD-close-on-mismatch is not implemented), never reads
   `agentCapabilities.promptCapabilities`, and never reads `agentCapabilities.loadSession`.
2. **`authenticate` is never called and `authMethods` is never read.** Radius
   handles auth entirely out of band — for fx, via encrypted agent state and a
   Codex OAuth flow declared in `fx-release-template.json`. A third-party harness
   that returns `auth_required` from `session/new` will simply fail with an
   opaque error. This is a concrete adapter cost for any Class 1 harness that
   authenticates over ACP.
3. **Model selection is a heuristic, not a contract.** `modelConfigOption()` in
   `session.ts` scans `configOptions` for a `select` option whose `id === "model"`,
   falling back to `category === "model" && name.toLowerCase() === "model"`. That
   is a guess at a convention. Harnesses that name it differently silently lose
   model selection; `setModel` then throws "The agent did not advertise model
   selection".
4. **Prompt output is text-only.** `AcpRuntimeSession.prompt()` accumulates only
   `agent_message_chunk` where `content.type === "text"`. (The desktop layer does
   handle `image` separately, so this is a runtime-package limitation, not a
   product one.)
5. **No reconnect / `session/load`.** Fresh connection and fresh session per run.
6. **The transport claim in the architecture doc is wrong.**
   `docs/architecture/agent-sdk-and-cli.md` line ~417 says Radius "uses ACP's
   **official** WebSocket transport". There is no official WebSocket transport.
   It is an experimental SDK export. This sentence should be corrected — it is
   the load-bearing false premise behind the map's dev design.
7. **The SDK dependency is pinned to a tarball URL, not a semver range:**
   `"@agentclientprotocol/sdk": "https://registry.npmjs.org/@agentclientprotocol/sdk/-/sdk-1.4.0.tgz"`
   in both `packages/runtime/package.json` and `packages/sdk/package.json`. Given
   that the WebSocket path lives under `experimental/`, pinning is prudent — but
   it should be a documented decision, not an accident.

### The manifest already disagrees with `init`

`AgentManifestSchema` in `packages/agent-contracts/src/index.ts` hardcodes:

```ts
protocol: z.object({
  kind: z.literal("acp-stdio"),
  version: z.literal(1),
}),
```

So **the shipped artifact contract is stdio-only.** `AgentBuildReceiptSchema`
agrees: `verification: { kind: "microvm-acp", platform: "linux/arm64" }`, and
`microvm.ts` verifies over `acpStreamFromChild`. WebSocket exists *only* in
`AgentDevelopmentConfigSchema`, i.e. only in `radius dev`.

Meanwhile `init.ts` writes, unconditionally for the TypeScript path:

```ts
development: { endpoint: "ws://127.0.0.1:7331/acp" }
```

…and installs `@curve-ai/sdk`. It never emits `runtime.kind: "command"`, and it
never offers the `--existing-acp` flag that `docs/architecture/agent-sdk-and-cli.md`
line ~392 proposes. The Python path in `init.ts` doesn't even write a
`development` block; it just prints "Next: expose a loopback ACP WebSocket
endpoint" and leaves the developer to build one — for which no first-party
helper exists (the architecture doc's own "Decisions still required" admits:
"First-party Python helper for the ACP WebSocket development server").

**That is the map's Known tension, in code.** It is not a philosophical
disagreement between two docs. It is that the dev-loop transport was chosen to
suit an SDK-authored agent, and every "bring your own harness" story fails at
that exact point.

---

## Half two — the harness classification

Authoritative ecosystem list: the ACP registry at
<https://agentclientprotocol.com/overview/agents> (~40 agents) and
<https://agentclientprotocol.com/overview/clients> (~27 editors/clients).

Two structural observations about that registry before the table:

1. **Every one of the ~27 clients is an editor plugin that spawns the agent as a
   subprocess.** Zed, JetBrains, Neovim (CodeCompanion, agentic.nvim,
   avante.nvim, hermes.nvim), Emacs (agent-shell.el), VS Code (several), Sublime,
   Qt Creator, Obsidian, Unity, Pulsar. Not one connects to a WebSocket. Radius
   would be the first ACP client to require one.
2. **fx is not in the registry**, despite implementing `fx acp`. The registry is
   a curated opt-in list, so absence is not evidence of absence — but it means
   the registry undercounts, and it is worth Radius submitting fx.

### What "fx" actually is — correcting the ticket's premise

The ticket guesses fx "wraps an upstream binary related to Codex". **It does
not.** From <https://github.com/vercel-labs/fx>:

> fx is a coding agent harness and CLI written in Zig, optimized for research
> and embeddability as part of larger systems.

…and "Tiny, open, embeddable, native coding agent", 7.8 MiB binary. It is
Vercel Labs' own agent, written in Zig, independent of Codex.

The Codex association is **authentication only**. From
`apps/runtime-host-macos/Config/fx-release-template.json`:

```json
"networkAllowlist": ["chatgpt.com", "auth.openai.com"],
"authRequirements": [{
  "key": "codex-subscription",
  "authority": { "key": "openai-codex", "issuer": "https://auth.openai.com" },
  "flow": { "kind": "provider_native_oauth",
            "audience": "https://chatgpt.com/backend-api/codex" }
}]
```

fx uses a ChatGPT/Codex **subscription as its model provider**. It is not a
Codex CLI wrapper. Pinned version in
`scripts/prepare-fx-agent-macos.sh`: `fx_version="0.0.5"`, Radius integration
`0.0.5-radius.3`, from `github.com/vercel-labs/fx/releases/download/v0.0.5`.

Its ACP entry point, from the same release template:

```json
"protocol": { "kind": "acp-stdio", "version": 1 },
"process": { "arguments": ["/usr/local/bin/agent", "acp"] }
```

`fx acp` — "connect to Agent Client Protocol clients". **stdio.** Class 1.

### Classification table

| Harness | Class | ACP entry point / adjacent surface | Evidence |
|---|---|---|---|
| **fx** (vercel-labs/fx, v0.0.5; Radius `0.0.5-radius.3`) | **1 — native ACP** | `fx acp` over **stdio**. Radius runs it as `["/usr/local/bin/agent","acp"]` inside the microVM. | `apps/runtime-host-macos/Config/fx-release-template.json`; `scripts/prepare-fx-agent-macos.sh`; <https://github.com/vercel-labs/fx> |
| **opencode** (sst/opencode) | **1 — native ACP** | ACP over **stdio**. Listed first-party in the ACP registry. WebSocket explicitly *not* supported — open FR. | <https://agentclientprotocol.com/overview/agents>; <https://github.com/anomalyco/opencode/issues/13388> |
| **Goose** (block/goose) | **1 — native ACP** | First-party; docs at `block.github.io/goose/docs/guides/acp-clients`. stdio. | <https://agentclientprotocol.com/overview/agents> |
| **Gemini CLI** (google-gemini/gemini-cli) | **1 — native ACP** | First-party. The ACP SDK README points at it as the reference production implementation: `packages/cli/src/zed-integration/zedIntegration.ts`. stdio. | SDK README ("Study a Production Implementation"); registry |
| **Claude Code / Claude Agent SDK** | **2 → 1 via adapter** | Registry entry is "Claude Agent — **via Zed's SDK adapter**". Not native. Adjacent surfaces if you'd rather not use the adapter: headless `claude -p --output-format stream-json --input-format stream-json`, and the Claude Agent SDK. | <https://agentclientprotocol.com/overview/agents> (row "Claude Agent"); <https://platform.claude.com/docs/en/agent-sdk/overview> |
| **Codex CLI** (openai/codex) | **2 → 1 via adapter** | Registry entry is "Codex CLI — **via ACP's adapter**". Not native. Adjacent: Codex's own JSON protocol / MCP-server modes. | <https://agentclientprotocol.com/overview/agents>; <https://developers.openai.com/codex/cli> |
| **Cursor CLI** | **1 — native ACP** | `cursor.com/docs/cli/acp`. Worth adding to the candidate set — a mainstream harness with documented first-party ACP. | <https://cursor.com/docs/cli/acp> |
| **GitHub Copilot CLI** | **1 — native ACP (public preview)** | Registry marks ACP support "in public preview". | <https://agentclientprotocol.com/overview/agents> |
| **Aider** | **3-ish / 2 — no ACP, no real server** | Not in the ACP registry. No ACP mode. Primarily an interactive TUI; scriptable via `--message`/batch flags rather than a persistent protocol server. A bridge would have to drive the CLI, not a protocol — the most expensive adapter on this list. | absence from <https://agentclientprotocol.com/overview/agents> |
| **LangChain / LangGraph** | **3 — library, not a server** | Not in the ACP registry. LangGraph Platform / `langgraph dev` exposes an HTTP+SSE assistants-style server, but that is *your* graph served, not a coding-agent harness. There is no process to attach ACP to; you would write one. | absence from registry; LangGraph Platform docs |
| **LlamaIndex** | **3 — library, not a server** | Not in the ACP registry. Workflows / llama_deploy can be served over HTTP, same caveat as LangGraph: it serves *your* application. | absence from registry |
| **CrewAI** | **3 — library, not a server** | Not in the ACP registry. Python framework for multi-agent crews; no attachable agent process. | absence from registry |

Adjacent registry entries that make useful comparators because they are
harnesses of the same shape as fx: Cline, Kimi CLI, Qwen Code, Mistral Vibe,
OpenHands, Docker's cagent, Stakpak, Augment Code, Kiro CLI, Junie (JetBrains),
Factory Droid, Poolside. Raxol is the one registry row that publishes its exact
launch command — `raxol acp` — which is the shape every Class 1 harness follows.

### What each class costs

**Class 1 (native ACP, stdio).** The wire protocol is free — Radius already
speaks it, and `packages/runtime/src/stdio.ts` is 15 lines. What is *not* free:

- **Getting a process launched at all in `radius dev`.** The harness is a
  subprocess that expects to be spawned. Today `radius dev` spawns nothing and
  demands a WebSocket URL. This is the whole cost, and it is a `radius dev`
  redesign, not a per-harness cost.
- **Auth.** If the harness advertises `authMethods` and rejects `session/new`
  with `auth_required`, Radius will fail opaquely (divergence #2). Per-harness
  work, once per harness.
- **Model selection**, if the harness names its config option something other
  than `model` (divergence #3).
- **Packaging for production**, i.e. a Linux/arm64 binary in a deterministic OCI
  layout — the `bundling-fx.md` process. This is the genuinely expensive part
  and it is per-harness.

**Class 2 (adapter exists).** Cost is one more process in the chain and one more
npm/pip dependency to pin and track. The adapter is itself an ACP-over-stdio
server, so from Radius's side it is indistinguishable from Class 1: `command` is
just the adapter's binary. Everything in Class 1's list still applies.

**Class 3 (library).** There is nothing to attach to. `init` cannot "configure a
harness" because there is no harness. The only honest answers are:

- scaffold an ACP server around the developer's LangChain/LlamaIndex/CrewAI code
  — which is exactly what `@curve-ai/sdk` already does, only for TypeScript; or
- say Radius does not support frameworks, only harnesses.

**This is the SDK-scaffold-vs-adapter tension resolving itself: the two products
serve disjoint classes.** Class 1 and 2 want `runtime.kind: "command"` plus a
spawn contract. Class 3 wants a scaffold. Neither is wrong; they are simply not
the same command. Forcing one `init` to do both is what produces the mess the
map worries about. The cheap resolution is that `init` asks which you have and
branches — the branch already half-exists in `init.ts` (`--python` vs
TypeScript) and in the architecture doc's unimplemented `--existing-acp`.

---

## Invariants versus what varies

### Invariant — every harness needs these from `init`, in every class

1. **A Radius agent identity** (`agent_*` ref, or a deterministic dev-time hash
   of the project root — `init.ts` already does the latter).
2. **A display name.**
3. **A declared capability set.** `capabilities[]` in `AgentConfigSchema`;
   requests, not grants, per `bundling-fx.md`'s release rules.
4. **A network allowlist.** Non-negotiable for the microVM.
5. **Resource limits** (cpu / memoryMb / diskMb) — defaulted, but present.
6. **A working directory contract.** Every ACP `session/new` needs a `cwd`, and
   Radius resolves it as `projectRoots[0] ?? release.process.statePath`.
7. **A commitment to ACP v1 over a newline-delimited JSON-RPC stream**, whatever
   carries the bytes.
8. **A `.gitignore` entry for `.radius/`.**
9. **A statement of how the agent authenticates to its model provider** — the
   thing `fx-release-template.json` calls `authRequirements`. Currently only
   expressible for bundled first-party agents; there is no user-facing config
   field for it at all.

### Varies — and this is what `init` must branch on

| Dimension | Class 1 / 2 (harness) | Class 3 (framework) |
|---|---|---|
| Does `init` write code? | No — config only | Yes — a scaffold |
| `runtime.kind` | `command` | `typescript` / `python` |
| Who owns the process in dev? | Radius should spawn it | the developer's watcher |
| Dev transport | **stdio** (all that exists) | WebSocket works, because the SDK serves it |
| Dependencies installed | none | `@curve-ai/sdk` / `radius-agent-sdk` |
| Auth | harness's own (`authMethods`, or out-of-band like fx's Codex OAuth) | developer's problem |
| Model selection | harness's `configOptions`, name unknown | SDK can guarantee `id: "model"` |
| Build story | pin + verify an upstream binary into OCI (`bundling-fx.md`) | build from source |

The single sharpest statement of the finding: **`development.endpoint` as a
required loopback WebSocket URL is only satisfiable by class 3 and by
Radius-SDK agents. For classes 1 and 2 — the entire "Radius adapts to your
agent" product — the correct dev contract is a spawn command, not a URL.**

---

## Recommendations for the map

1. **Correct `docs/architecture/agent-sdk-and-cli.md`** — delete "ACP's official
   WebSocket transport". Replace with "the ACP SDK's experimental WebSocket
   transport", and note the pin.
2. **Make `AgentDevelopmentConfigSchema` a discriminated union**, mirroring
   `AgentRuntimeConfigSchema`: `{ kind: "command", command: string[] }` for
   spawn-over-stdio, `{ kind: "websocket", endpoint, authorizationEnv }` for the
   existing SDK path. The stdio branch is the one that unlocks every real
   harness, and `packages/runtime/src/stdio.ts` already implements it — this is
   plumbing, not new protocol work.
3. **Aim the experiment tickets at classes, not products.** One Class 1 stdio
   harness (opencode or Goose — both first-party, both free of Codex auth
   entanglement), one Class 2 adapter (Codex CLI or Claude Code, to price the
   extra hop), one Class 3 framework (LangChain, to prove the scaffold story is
   a different command). fx is the control, since it already works.
4. **Fix the `initialize`-response gap before the experiments run**, or the
   experiments will produce opaque failures that get misattributed to the
   harness. Reading `authMethods` and `protocolVersion` is a handful of lines in
   `session.ts` and it is the difference between "opencode doesn't work" and
   "opencode wants us to call `authenticate`".

---

## Open questions this surfaced

- **Should `radius dev` sandbox at all?** The dev path bypasses the microVM
  entirely (`agent-runtime.ts:1893` — dev connection wins, `MicrovmAcpRuntime`
  is skipped). If dev switches to spawning third-party harness binaries, Radius
  is spawning untrusted code unsandboxed on the developer's machine. That is a
  different security posture from "the developer already ran their own agent".
- **What is `radius build` for a Class 1 harness?** `bundling-fx.md` is a
  maintainer runbook with pinned checksums and hand-verified notices. Can a user
  run that for an arbitrary harness, or does Radius become a curator of a
  blessed harness set?
- **Is ACP v2 a near-term forcing function?** The SDK ships `experimental/v2`
  today, and v2 **removes File System and Terminals** from core (moved to RFDs)
  per the spec index. Radius's client depends heavily on `fs/*` and `terminal/*`.
- **Should Radius adopt the draft Streamable HTTP transport instead of
  WebSocket?** It is the one non-stdio transport the spec is actually
  standardising, and `experimental/http-client` is already in the pinned SDK.
- **How does `authRequirements` become a user-facing concept?** It exists only in
  the internal release template. Any third-party harness needing provider auth
  has nowhere to declare it.
- **Should Radius register fx in the ACP registry**, and register Radius itself
  as an ACP client? Radius is not on the clients list.
