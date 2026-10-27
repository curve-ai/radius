# Agent authoring, packaging, and CLI

## Responsibility boundaries

Agents implement the standard Agent Client Protocol using its official SDKs.
ACP owns protocol types, transports, initialization, session requests, streaming
updates, cancellation, permission requests, and host capabilities. Agent authors
own their model calls, reasoning loop, and session state.

Radius owns developer configuration, immutable OCI packaging, installation,
local execution, registry/deployment operations, and desktop integration.
There is no separate Radius agent-definition API or Python SDK.

## Examples and scaffolding

- `examples/typescript-agent/radius/agent.ts` uses `agent`, `methods`, and
  `ndJsonStream` from `@agentclientprotocol/sdk` directly.
- `examples/python-agent/radius_python_agent/agent.py` implements the official
  Python `Agent` interface and uses `run_agent` for stdio.
- `radius init` and `radius init --language python` generate the same ACP-native
  starting points. They install the official language SDK, plus the Radius
  CLI/build tooling needed by the TypeScript workflow.

The examples are minimal echo agents. More capable agents implement their own
session lifecycle, cancellation, model loop, and ACP capabilities. Radius does
not substitute a callback framework for the upstream agent interface.

## Radius runtime adapters

`@curve-ai/radius-runtime` is primarily the ACP client and process/microVM
runtime. Two optional subpaths integrate ACP agents with Radius:

- `@curve-ai/radius-runtime/development` exposes a loopback HTTP/WebSocket
  development endpoint. Pass a factory returning an official ACP `AgentApp`;
  the server creates a fresh app for each connection.
- `@curve-ai/radius-runtime/authentication` verifies and stores the Radius
  `radius-oauth` credential carried in ACP authentication metadata. Construct
  one authentication adapter per connection, advertise its `authMethods`,
  delegate the authentication request to it, and call `requireCredential()`
  before protected operations. The supplied verifier validates tokens against
  the agent vendor's resource server. Clear the adapter on disconnect.

These adapters do not define an agent or replace ACP session handlers.
See [vendor authentication](../guides/vendor-authentication.md) for the credential
exchange and desktop configuration.

## Developer configuration

The CLI validates the versioned `@curve-ai/agent-contracts` schema. TypeScript
projects use `radius.config.ts`; Python projects use `[tool.radius]` in
`pyproject.toml`. Configuration describes the agent reference, runtime
entrypoint/module, requested capabilities, network allowlist, resources, and
minimum desktop version. This deployment metadata is separate from ACP.

TypeScript development:

```sh
# In the example or generated project, use two terminals:
bun run agent:dev
radius dev
radius validate
radius build
radius deploy
```

`radius dev` registers the configured live development endpoint; it does not
build or deploy an image. Python authors can use an upstream ACP transport
server and configure `development.endpoint` when they need this live workflow.
Both languages support stdio inside their packaged agents.

## OCI builds

The TypeScript builder bundles the configured entrypoint into a Node image.
The development-only runtime adapter remains outside the production bundle.
The Python builder exports hashed runtime requirements from the project's
`uv.lock`, copies the configured module tree, and installs those requirements
in the pinned Python/uv image. It does not locate another Radius checkout or
build a first-party SDK wheel.

Both builders produce an OCI layout, a versioned Radius manifest, and immutable
build identity from source/configuration inputs. Builds use the existing
architecture and runtime contracts. The CLI validates the package and executes
its existing ACP verification before a successful build receipt is promoted.
Failed builds do not become the latest verified build.

Deployment, promotion, rollback, organization membership, and token commands
remain owned by the CLI and Platform APIs. They are independent of which
language or official ACP SDK produced the agent.

Detailed development, build-receipt, deployment, profile, and compatibility
contracts remain in [CLI workflow contracts](cli-workflow-contracts.md).

## Validation

From the Radius repository:

```sh
bun run --cwd packages/runtime test
bun run --cwd packages/cli test
bun run --cwd packages/agent-build test
bun run --cwd examples/typescript-agent test
uv run --directory examples/python-agent pytest
uv run --directory examples/python-agent ruff check .
```

The runtime tests cover protocol handling, permissions, cancellation, and
Radius authentication/transport integration. Example tests exercise the direct
ACP authoring path. Container builds and live package execution remain separate
integration checks requiring Docker or the native runtime.
