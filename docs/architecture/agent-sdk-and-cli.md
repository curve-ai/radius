# Agent SDK and CLI developer experience

**Status:** Implemented foundation; publication remains pending
**Date:** 2026-08-27
**Accepted direction:** An agent developer can add Radius to an existing
repository, run the agent locally, and deploy the same agent to Curve Cloud
or a compatible self-hosted Radius Platform.

## Implemented foundation

The first public implementation now includes:

- `@curve-ai/agent-contracts` with language-neutral TypeScript, Python, and
  command runtime configuration plus normalized agent manifests.
- `@curve-ai/build` with config validation, manifest creation, and canonical
  JSON generation.
- `@curve-ai/sdk` with a real ACP v1 TypeScript agent server, text streaming,
  session lifecycle, and cancellation propagation.
- `@curve-ai/cli` with safe `init`, config `validate`, native one-shot or
  interactive `dev`, Python/command process launch paths, and deterministic
  `deploy --dry-run` manifest output.
- Recursive project watching that ignores generated/dependency trees, lets an
  in-flight turn finish, then reloads config and replaces the development agent
  before the next prompt. `--no-watch` disables it.
- A working `dev --sandbox` path that bundles the TypeScript entrypoint,
  creates a pinned non-root `linux/arm64` Node OCI image, imports it through the
  Swift runtime helper, and prompts it through `MicrovmAcpRuntime`.
- `@curve-ai/platform-contracts` and `@curve-ai/platform-client` with validated
  compatibility, identity, deployment-prepare, and deployment-finalize HTTP
  contracts, HTTPS/loopback enforcement, bearer authentication, bounded JSON,
  structured errors, and idempotency headers.
- Non-secret CLI target profiles with mode-0600 storage, active-profile
  switching, `platform-info`, and `whoami`. Interactive login stores tokens in
  the native operating-system credential manager; CI can supply an explicit
  environment token. Tokens never enter profile files.
- A public `apps/platform-api` Hono service with live health/compatibility,
  bearer authentication middleware, bounded request bodies, idempotency
  enforcement, structured errors, and injected identity/deployment providers.
- Remote CLI deploy orchestration for compatibility check → deterministic OCI
  build → deployment preparation → short-lived registry login/push → exact digest
  finalization. Provider fakes prove the sequence, and the development provider
  plus pinned Distribution registry prove a real push/finalize/promotion loop.
- Explicit `radius promote <agent-deployment-id>` and
  `radius rollback --to <agent-deployment-id>` commands that select existing
  immutable deployments with optimistic environment
  revisions and never rebuild an agent.
- Paginated `radius deployments list` and `radius environments status` reads
  with text and JSON output. Deployment cursors are stable across newly
  inserted immutable versions, and environment history is append-only
  newest-first.
- `radius tokens list|create|revoke` for owner-controlled, one-time-secret
  developer credentials. Scope escalation and current-token self-revocation
  fail closed; lifecycle changes are idempotent and audited.
- `sdks/python` with `radius-agent-sdk`, a thin ACP 0.12.1 authoring layer for
  prompt text, streaming updates, and per-session cancellation.
- Native Python configuration from `[tool.radius]` in `pyproject.toml`,
  `radius init --language python`, committed `uv.lock`, and `uv run --locked`.
- Deterministic Python 3.12 Linux/arm64 OCI builds using digest-pinned official
  Python and uv images, a source allowlist limited to the declared module
  package, hashed lock export, and a locally built SDK wheel.
- The same real Python agent has passed native ACP, microVM sandbox, repeat
  deterministic-image, registry push, deployment finalization, and staging
  promotion smokes.
- `examples/typescript-agent` proving config validation, CLI-to-agent ACP
  execution, and stable dry-run output.

Not yet implemented: provider-specific registry provisioning, broader Python
capability/artifact helpers, and full agent-package SBOM/provenance
construction. Browser OIDC login, host-only sessions, native CLI credential
custody, durable PostgreSQL authority, one-time owner bootstrap, TLS ingress,
and operator-supplied registry/secret configuration are implemented in the
Docker Compose self-host distribution. No GHCR, npm, or PyPI package has been
published yet.
Source workspace manifests remain private and no registry publication has been
performed. The release pipeline now stages seven dist-only public npm
artifacts, checksums them, installs their complete dependency graph in a clean
external project, imports the SDK/contracts/client, and runs the packaged CLI
through init and validate. External default installation becomes available
only after that coherent release set is explicitly published.
The Python wheel is also rebuilt twice deterministically, inspected for license
and metadata boundaries, installed into a clean Python 3.12 environment from
the public PyPI dependency index, imported, and used to construct an agent.

## Objective

Radius should make the shortest path from agent code to a controlled desktop
deployment feel like:

```bash
bunx @curve-ai/cli@latest init
bunx @curve-ai/cli@latest dev
bunx @curve-ai/cli@latest deploy
```

`npx`, `pnpm dlx`, and a pinned development dependency should expose the same
`radius` executable. Bun is the Radius workspace package manager, but an agent
repository does not need to adopt Bun merely to use the CLI.

The experience takes inspiration from Trigger.dev's documented
[`init` → `dev` → `deploy` loop](https://trigger.dev/docs/how-it-works) and
[existing-repository quick start](https://trigger.dev/docs/quick-start) while
preserving Radius's local-first execution, ACP protocol, permission broker,
immutable OCI package, and desktop rollout boundaries.

## Domain vocabulary

- **Organization:** tenant and distribution boundary.
- **Agent:** stable organization-owned metadata and public reference.
- **Environment:** a named deployment track within an agent, initially
  development, staging, or production.
- **Agent deployment:** one immutable, digest-addressed version of an agent.
- **Environment revision:** the desired agent deployment for an environment at
  an explicit revision.
- **Membership:** one user's role and access inside the company organization.

The Platform and CLI say agent and deployment. `project` is reserved for a
local desktop work folder.

## Packages

### `@curve-ai/sdk`

The runtime authoring SDK for TypeScript agents:

- Defines one agent entrypoint.
- Implements the stable ACP-facing lifecycle on the developer's behalf.
- Provides typed prompt, progress, artifact, cancellation, and error APIs.
- Provides clients for host-brokered capabilities and connectors.
- Never grants a capability; it can request only capabilities declared in the
  static package configuration and resolved by the Radius host.
- Does not contain Cloud credentials, registry logic, deployment APIs, or
  billing behavior.

The SDK should remain small and runtime-focused. Model-provider selection and
the reasoning loop remain developer-owned.

### `@curve-ai/build`

The build/configuration package:

- Exports `defineConfig` and the versioned configuration schema.
- Resolves entrypoints, files, runtime requirements, static capability
  declarations, and build hooks.
- Produces the normalized agent manifest consumed by packaging.
- Is a development dependency and is not bundled into the running agent unless
  the agent imports it explicitly.

### `@curve-ai/cli`

The command package exposing the `radius` executable:

- Initializes and links a repository.
- Runs the local development supervisor and file watcher.
- Validates SDK/build/CLI compatibility.
- Builds deterministic deployment inputs and OCI artifacts.
- Authenticates to Curve Cloud or a self-hosted Platform profile.
- Uploads packages and manages deployment promotion and rollback.
- Stores tokens in the operating-system credential store, never in project
  configuration.

### Public contracts

`@curve-ai/agent-contracts` owns the configuration, manifest, deployment,
deployment, compatibility, provenance, and API-envelope contracts shared by
the SDK, CLI, desktop, and control plane. Browser-safe API types remain
separate from server implementations.

## Language strategy

TypeScript is the first first-party authoring experience because Radius already
uses TypeScript across the desktop sidecar, public contracts, build tooling,
and future control plane. The manifest, ACP transport, OCI package, deployment,
deployment, and CLI profile contracts remain language-neutral from the first
version.

The sequence is:

1. TypeScript SDK, build plugin, and CLI developer loop.
2. Existing Python and other-language ACP agents through the command/OCI
   integration mode.
3. First-party Python SDK and `uv` project integration after the TypeScript
   lifecycle is validated. The initial implementation is now complete.

This means a Python agent does not need to wait for a Radius-specific Python
SDK if it already implements ACP. The official
[ACP Python SDK](https://agentclientprotocol.github.io/python-sdk/) supports
Python clients and agents over the same stdio protocol Radius already uses.

## Integration modes

### SDK-native TypeScript agent

The primary first-party developer experience. The SDK supplies the ACP adapter
and typed Radius capabilities around developer-owned agent logic.

Illustrative, non-final source:

```ts
import { defineAgent } from "@curve-ai/sdk";

export default defineAgent({
  async run({ prompt, tools, artifacts, signal }) {
    const result = await runMyAgent({ prompt, tools, signal });
    await artifacts.writeText("result.md", result.markdown);
    return { text: result.summary };
  },
});
```

### Existing ACP agent

An existing fx-, Hermes-, Python-, Rust-, or other agent can supply an ACP
command instead of adopting the TypeScript authoring API. The same CLI builds,
packages, tests, uploads, and deploys it. Radius should not require developers
to rewrite a mature agent loop in the first-party SDK.

### First-party Python agent

The implemented `radius-agent-sdk` is a thin Radius layer over the official
`agent-client-protocol==0.12.1` package rather than an independent protocol
implementation. Its current responsibilities are:

- Agent/session lifecycle, prompt normalization, and text streaming.
- Per-session cancellation exposed through `RunContext`.
- The same ACP stdio transport and stop reasons as the TypeScript SDK.
- No model-provider ownership, deployment token, registry client, or hidden
  Cloud dependency.

Implemented source shape:

```py
from radius_agent_sdk import RunContext, define_agent, serve_stdio


async def run(context: RunContext) -> str:
    return f"Python received: {context.text}"


agent = define_agent(name="my-agent", run=run)

if __name__ == "__main__":
    serve_stdio(agent)
```

Structured capability, artifact, and provenance helpers remain follow-on SDK
work. They must delegate to public host contracts rather than bypass ACP.

## Project files

The default TypeScript `init` result is intentionally small:

```text
existing-agent-repository/
├── radius/
│   └── agent.ts
├── radius.config.ts
├── .radius/
│   ├── builds/             # generated and ignored
│   ├── dev/                # local runner state and ignored
│   └── cache/              # generated and ignored
└── package.json
```

No credential, organization identifier, access token, or secret belongs in
`.radius/` or `radius.config.ts`. A non-secret agent reference may be stored
in configuration after explicit linking, but local development must also work
without one.

The CLI normalizes every language-specific configuration into the same public
configuration schema before validation. TypeScript may use
`radius.config.ts`; Python may use a `[tool.radius]` table in `pyproject.toml`
or another schema-backed serialized frontend. Neither language-specific form
can add capabilities that are absent from the normalized manifest.

Illustrative, non-final configuration:

```ts
import { defineConfig } from "@curve-ai/build";

export default defineConfig({
  agent: "agent_example", // optional until linked
  minimumDesktopVersion: "0.0.1",
  runtime: {
    kind: "typescript",
    entrypoint: "./radius/agent.ts",
    node: "22",
  },
  capabilities: [
    { key: "workspace.files", operations: ["read", "write"] },
    { key: "radius.mcp", requirement: "optional" },
  ],
  resources: {
    cpu: 2,
    memoryMb: 4096,
  },
});
```

The configuration is static build input. Do not execute arbitrary agent code
to discover capabilities before trust and policy evaluation.

### Python project layout

The first supported Python layout should use standard `pyproject.toml` metadata
and `uv.lock`:

```text
existing-python-agent/
├── pyproject.toml
├── uv.lock
├── radius_agent/
│   ├── __init__.py
│   └── agent.py
└── .radius/
    ├── builds/
    ├── dev/
    └── cache/
```

`uv.lock` is a universal lockfile that records dependencies across Python,
operating-system, and architecture markers. It is committed to the agent
repository; `.venv/` is not. See the official
[`uv` project layout](https://docs.astral.sh/uv/concepts/projects/layout/).

Implemented Python configuration shape:

```toml
[project]
name = "my-agent"
requires-python = ">=3.12,<3.15"
dependencies = [
  "radius-agent-sdk",
]

[tool.radius]
schemaVersion = 1
agent = "agent_example"
name = "My Agent"
minimumDesktopVersion = "0.0.1"
capabilities = []
networkAllowlist = []

[tool.radius.runtime]
kind = "python"
module = "radius_agent.agent"
python = "3.12"
lockfile = "uv.lock"
```

The first sandbox proof produced stable build digest
`8003d68d6b6ce7d3bd4a7de6080476011be473ab3e2a6efcd8b254e8ef7bddf2`,
source OCI manifest
`sha256:46fe314b3fa9eace552b12ded356124843d2166f8f826ed290a07e5e4e32e73c`,
and imported runtime digest
`sha256:e2ce208621475ed7b58496f8bb0e366d0fd64d6a6f78b6db5f0381d88084e1f7`.
The repeat run produced the same values. Remote deployment pushed registry
digest
`sha256:a1c8a3e68fe0a5226c4f6ff3f212ada5e7d6e1250650a8de9afdbe9bba83ebe2`
and promoted deployment `20260825.1` to staging revision `1`.

## `radius init`

`init` adds Radius to an existing repository without requiring deployment.

Expected flow:

1. Find the repository root and package manager.
2. Detect an existing `radius.config.*` and refuse to overwrite it unless
   `--force` is explicit.
3. Offer TypeScript SDK-native or existing-ACP integration.
4. Install compatible SDK/build packages using the repository's package
   manager, or print exact commands with `--skip-install`.
5. Create `radius.config.ts`, the chosen entrypoint, and `.gitignore` entries.
6. Validate the configuration and perform a local protocol smoke.
7. If the developer is logged in, optionally create or select an organization
   agent and write its non-secret agent reference.
8. Print the next command: `radius dev`.

Local initialization is offline-capable. Authentication and agent creation
are optional until the first remote deploy.

Proposed options:

```text
--agent-ref <ref>         link an existing agent
--api-url <url>           select a Platform instance
--profile <name>          use a stored target profile
--existing-acp            configure an existing ACP command
--python                  configure a Python project using pyproject.toml
--javascript              generate JavaScript instead of TypeScript
--skip-install            do not mutate package dependencies
--force                   replace generated Radius files only
```

## `radius dev`

The default loop optimizes edit-to-run latency while keeping a sandbox-parity
path available.

```text
source change
    │ watch + validate + incremental bundle
    ▼
local development supervisor
    │ ACP over authenticated local transport
    ├──> Radius desktop development session
    └──> optional linked Platform test page
```

### Default native development mode

- Runs developer-owned code as a supervised local child process.
- Uses the same ACP lifecycle and host capability broker as packaged agents.
- Watches configured source and restarts only after a valid build.
- Defers replacement until the next prompt so a source change does not kill an
  in-flight turn; generated `.radius`, dependency, Git, coverage, and `dist`
  paths are ignored.
- Pins an in-flight run to the build that started it; a file change affects
  only new runs.
- Streams logs, progress, tool requests, artifacts, and failures to the CLI and
  connected Radius desktop.
- Requires explicit permission for local files and tools; development mode is
  not implicit Full access.
- Works without Cloud or a self-hosted Platform.

Native mode is a developer-convenience boundary, not evidence that an OCI
agent works inside the distributed microVM.

Watching is enabled for interactive `radius dev` and can be disabled with
`--no-watch`. One-shot `--prompt` runs use the source snapshot present when the
command starts.

### Sandbox parity mode

`radius dev --sandbox` builds an OCI candidate from a bundled TypeScript
entrypoint, imports it into Radius-owned storage, and runs it through the actual
local microVM host. The current development path uses Docker Buildx as the
builder, then leaves execution entirely to Radius. It is slower and is required
before deploy unless CI or `deploy` performs the equivalent smoke.

The current TypeScript sandbox builder requires Docker Buildx. Developers
should eventually avoid Docker or Podman for static/supported build paths;
BuildKit remains the explicit initial provider until Radius has a complete
built-in builder.

### Linked development mode

With `--profile`, the CLI may register ephemeral developer presence with a
Platform instance so its project test page can initiate runs and display live
results. Agent execution remains on the developer's machine. The connection is
outbound, scoped to the linked project/environment, revocable, and never opens
an unauthenticated inbound port.

Proposed options:

```text
--sandbox                use the real packaged microVM path
--profile <name>         expose dev presence to one Platform instance
--config <path>          select a non-default config
--env-file <path>        load local-only developer variables
--no-open                do not open Radius or a test page
--log-level <level>      control CLI verbosity
```

Environment-file values are injected only into the local run. They are never
copied into image layers, manifests, build logs, or deployment metadata.

### Python native development

For a Python project, native development resolves the configured interpreter,
verifies `uv.lock`, and runs the entrypoint through a locked environment, for
example `uv run --locked`. Radius should initially require a compatible `uv`
installation, then consider managing a pinned `uv` and Python toolchain after
the workflow is proven. `uv` can manage missing Python installations, but
automatic downloads must be explicit and visible to the developer.

The file watcher restarts the Python ACP subprocess after syntax/configuration
validation. It never mutates `uv.lock` during `dev` or `deploy`; dependency
changes require the developer to update and commit the lock deliberately.

### Python sandbox and deployment build

Python deployment builds inside the target Linux architecture. It never copies
the host `.venv`, macOS wheels, caches, or interpreter into the image.

The build should:

1. Start from a digest-pinned supported Python Linux base.
2. Copy a digest- or version-pinned `uv` binary into the build stage.
3. Resolve the committed lock for the target Python version and Linux
   architecture with `--locked`/`--frozen` behavior.
4. Install dependencies into an isolated image environment.
5. Copy agent source only after dependency installation for layer reuse.
6. Remove build caches and run as the standard non-root Radius agent user.
7. Launch the Python ACP entrypoint over stdio.
8. Generate an SBOM covering the Python interpreter, base image, wheels, native
   libraries, and agent source.
9. Run protocol and health checks in the actual Radius microVM.

Pure-Python and `manylinux` wheel dependencies are the first support target.
Packages that require compilation must build in the target Linux builder with
pinned system dependencies. Radius should support native `linux/arm64` first;
cross-architecture `linux/amd64` output is a later explicit target rather than
an accidental host build.

Astral documents copying a pinned `uv` binary into a Python container and
installing locked projects in separate dependency/source layers. Radius should
adopt that reproducible pattern without inheriting an unpinned `latest` image.
See [`uv` in Docker](https://docs.astral.sh/uv/guides/integration/docker/).

## Authentication and target profiles

The CLI supports the same commands against Curve Cloud and compatible
self-hosted Platform instances:

```bash
radius login
radius login --api-url https://platform.example.com --profile self-hosted
radius profiles list
radius profiles switch self-hosted
radius whoami
radius logout --profile self-hosted
```

A profile contains:

- Name and normalized API origin.
- No token, secret, account data, or credential-store locator.

The credential-store account is derived from the profile name and a SHA-256
fingerprint of the normalized API origin. `radius login` reads the token from
hidden TTY input or stdin, validates it with `/identity`, and only then stores it
in macOS Keychain, Windows Credential Manager, or Linux Secret Service through
`@napi-rs/keyring`. `radius logout` deletes that entry. If the native store is
unavailable, the CLI fails closed and instructs the caller to use an environment
token; it never falls back to a plaintext credential file.

CI does not use interactive profiles. It receives short-lived or narrowly
scoped `RADIUS_ACCESS_TOKEN`, `RADIUS_API_URL`, and optionally
`RADIUS_PROJECT_REF` values from the CI secret store.

Credential precedence is explicit argument for library callers, then
`RADIUS_ACCESS_TOKEN`, then the OS keyring. This keeps CI deterministic while
allowing local commands such as deploy, inventory, promotion, rollback,
whoami, and token management to reuse validated stored credentials.

## `radius deploy`

V1 builds locally for both Cloud and self-hosted targets. A managed remote
builder can be added later behind the same build contract.

```text
agent source
    │ validate config and compatibility
    ▼
normalized manifest + bundled source
    │ deterministic build
    ▼
OCI image + SBOM + provenance
    │ local sandbox smoke
    ▼
short-lived scoped registry credentials
    │ push exact digest
    ▼
immutable Platform agent deployment
    │ optional promotion
    ▼
environment deployment revision
```

Deploy steps:

1. Resolve the config, selected profile, organization, agent, and
   environment.
2. Verify CLI, SDK, build package, manifest, host, and server compatibility.
3. Refuse dirty generated state, missing declared files, undeclared required
   capabilities, or credentials detected in build inputs.
4. Produce a deterministic bundle, normalized manifest, OCI image, SBOM, and
   provenance statement.
5. Run manifest/protocol checks and the sandbox smoke unless an exact build
   digest already has valid evidence.
6. Create an idempotent deployment intent and request short-lived,
   agent-scoped registry credentials.
7. Push the image and evidence, then submit the exact digest.
8. Let the Platform independently verify digest, size, compatibility,
   provenance, and policy before creating an immutable deployment.
9. Promote the deployment to the selected environment unless
   `--skip-promotion` is set.
10. Print the deployment digest, human version, environment revision, and
    dashboard URL.

The implemented development provider completes this sequence against a pinned
local Distribution registry. It verifies the pushed digest with the registry
before finalization, persists the immutable deployment and revision-checked
promotion in PostgreSQL, and transactionally creates a credential-free outbox
message for independent BullMQ verification.

The explicit promotion and rollback path is also implemented. A live
development smoke created deployment `20260826.2` without promotion, promoted
it to staging revision `2`, and then rolled back to deployment `20260826.1` at
revision `3`. Both operations selected existing deployment IDs and supplied the
expected prior revision; the temporary source change used to produce the
second digest was restored afterward.

Commands and options (implemented unless noted):

```bash
radius deploy
radius deploy --environment staging
radius deploy --organization acme --environment staging
radius deploy --dry-run
radius deploy --skip-promotion
radius deploy --profile self-hosted

radius deployments list
radius deployments list --limit 25 --json
radius environments status --environment production
radius promote <agent-deployment-id> --environment production
radius rollback --environment production --to <agent-deployment-id> --expected-revision 2

radius tokens list --json
radius tokens create --label "CI deploy" --scope agent.read --scope deployment.write
radius tokens revoke <token-id>
radius members list --organization acme
radius members role <membership-id> --role developer --organization acme
radius members suspend|restore|remove <membership-id> --organization acme
```

`--dry-run` writes the exact normalized manifest, build context, OCI metadata,
SBOM, and provenance beneath `.radius/builds/` without uploading or mutating a
Platform.

Promotion and rollback never rebuild. They update desired deployment state
with an expected revision so concurrent operators cannot silently overwrite
one another.

## Version and compatibility contract

- The CLI, build package, and public agent contracts release as one compatible
  toolchain line.
- The runtime SDK may evolve independently within declared compatibility
  ranges.
- `dev` and `deploy` detect mismatched Radius package versions and fail with
  exact repair commands. They do not update dependencies without confirmation.
- A manifest declares its contract version, minimum host version, and supported
  runtime architectures.
- The Platform reports supported contract and CLI ranges before accepting a
  deployment.
- A self-hosted Platform and its CLI may be pinned to matching release tags.
- Every run remains pinned to the deployment and runtime versions with which it
  began.

## Failure and recovery behavior

- CLI commands are non-interactive and produce stable exit codes under `CI=1`.
- Every remote mutation accepts an idempotency key.
- Upload can resume by content digest without creating a second deployment.
- A failed upload never changes the active deployment.
- A successful upload with failed verification remains quarantined and cannot
  be promoted.
- Cancellation stops the current step and records a terminal deployment
  attempt; it does not delete uploaded immutable content needed for audit.
- Machine-readable `--json` output is available for CI and other developer
  tools.

## Security boundaries

- The SDK never receives deployment or organization administration tokens.
- The CLI never writes access tokens to the project repository.
- Build inputs exclude `.env*`, credential stores, Git metadata, caches, and
  ignored files unless an explicit safe include is declared.
- Secrets are materialized only for a run through host or Platform secret
  references and are never embedded in OCI layers.
- Static capability declarations are requests, not grants.
- Local native development is visibly distinct from sandbox verification.
- Registry credentials are short-lived and scoped to one agent/repository
  upload.
- The Platform verifies uploaded evidence rather than trusting CLI success.
- Radius desktop verifies the signed desired deployment and exact digest before
  installation.

A managed or white-label desktop build may also carry a bundled-agent index as
offline bootstrap desired state. That index uses the same stable Platform
agent identity and immutable deployment inputs as remote deployment. It does not
create a separate marketplace identity or make employees install agents by
hand; account sign-in remains a declared deployment requirement after delivery.

## MVP developer journey

The first complete proof should be:

1. Add Radius to an existing TypeScript repository with `radius init`.
2. Implement or adapt one agent entrypoint.
3. Run it from `radius dev` and test through the Radius desktop.
4. Pass `radius dev --sandbox` through the deterministic OCI and microVM path.
5. Log in to either Curve Cloud or a self-hosted instance.
6. Run `radius deploy --environment staging`.
7. Review the immutable deployment in the open dashboard.
8. Promote it to production for the organization.
9. Confirm an organization user can see and run the agent in Radius.
10. Roll back to the prior deployment without rebuilding.

After that TypeScript path is stable, the equivalent Python proof is:

1. Initialize an existing `pyproject.toml`/`uv.lock` repository with
   `radius init --language python`.
2. Run its ACP agent through `radius dev` using the locked local environment.
3. Build a fresh Linux/arm64 environment with `radius dev --sandbox`.
4. Deploy and roll back the resulting immutable OCI deployment through the same
   Platform commands used by TypeScript.

## Explicit non-goals for the first SDK/CLI release

- General-purpose workflow orchestration unrelated to one agent.
- A model-provider abstraction that owns the developer's reasoning loop.
- Automatic publication to a public marketplace.
- Cloud execution fallback for a local desktop agent.
- Arbitrary dashboard code supplied by agent packages.
- Silent dependency upgrades, silent capability expansion, or implicit access
  to the developer's machine.

## Decisions still required

- Final npm package names and executable distribution.
- Final configuration and TypeScript SDK surface.
- Publication and versioning of the Python SDK wheel outside this workspace.
- Structured Python capability, artifact, and provenance helper APIs.
- Native development transport between CLI and Radius desktop.
- Which general agent builds can avoid Docker/BuildKit.
- Signing-key custody and publisher verification.
- Release-version display format and content-digest deduplication rules.
- Exact test-page behavior for linked development mode.
