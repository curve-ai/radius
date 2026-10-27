# CLI workflow contracts

These workflow and compatibility contracts are retained from the original
authoring specification. Agent implementations now use the official ACP SDKs;
[authoring and package ownership](agent-sdk-and-cli.md) describes that boundary.

## `radius dev`

Development connects the ready Radius application to an agent process that the
developer already runs with the repository's normal tools.

```text
developer-owned watcher and process
    │ ACP over authenticated loopback WebSocket
    ▼
installed Radius development registration
    │ real desktop UI, host tools, history, and approvals
    ▼
agent response
```

- Radius never owns the agent process, package manager, file watcher, or hot
  reload policy.
- The development endpoint must be `ws://` or `wss://` on loopback. ACP
  specifies stdio only; WebSocket is an `experimental/` export of the
  `@agentclientprotocol/sdk` package, not a spec transport. Radius uses that
  experimental export and may attach a bearer value read from a named
  environment variable.
- The CLI writes one mode-0600 registration beneath Radius user data, launches
  or focuses Radius, watches only the Radius config file, and deletes the
  registration on termination.
- The desktop watches registrations, gives an active development connection
  precedence over an installed release with the same agent identity, and opens
  a fresh ACP connection for each run. Agent restarts therefore affect the next
  run without restarting Radius.
- Cosmetic and endpoint config changes reload. Agent identity cannot change
  while the registration is active. Invalid config retains the last valid
  registration and reports the error in the CLI.
- Development mode uses the real Radius desktop, host capability broker,
  project context, history, and approval behavior, but no VM or OCI image.
- Development registration is local-only and is never accepted as production
  desired state.

Implemented options:

```text
--endpoint <ws-url>              override development.endpoint
--authorization-env <name>      override development.authorizationEnv
--config <path>                 select a non-default config
```

## `radius build`

Build is the package/runtime parity boundary. It is separate from live
development and remote deployment.

1. Load and validate the Radius config.
2. Produce the deterministic TypeScript or Python `linux/arm64` OCI layout.
3. Import that exact layout into Radius-owned image storage.
4. Start it in the real microVM and complete ACP initialization plus session
   creation.
5. Stop the verification runtime and write `receipt.json` beside the OCI layout.
6. Update `.radius/builds/latest.json` only after verification succeeds.

The receipt contains the build digest, source OCI manifest digest, bundle hash,
normalized agent manifest, relative layout/context paths, verification time,
and verified platform. Failed builds and failed ACP verification runs never become latest.

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

Deploy consumes a successful local build receipt for both Cloud and self-hosted
targets. It never compiles source or recreates the OCI image.

```text
verified build receipt + OCI layout
    │ validate receipt against current config
    ▼
short-lived scoped registry credentials
    │ load and push the existing OCI layout
    ▼
immutable Platform agent deployment
    │ optional promotion
    ▼
environment deployment revision
```

Deploy steps:

1. Resolve the config, selected profile, organization, agent, and
   environment.
2. Resolve the requested receipt, or the latest successful receipt by default.
3. Require its normalized manifest to match the current Radius config. A stale
   receipt fails with an instruction to run `radius build`.
4. Verify Platform compatibility for the receipt's manifest version.
5. Create an idempotent deployment intent and request short-lived,
   agent-scoped registry credentials.
6. Load the receipt's OCI layout into the local image store, retag it only for
   the scoped upload, push it, and inspect the registry digest. No Docker build
   command runs during deploy.
7. Submit the exact pushed digest and source manifest digest.
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

Commands and options (implemented unless noted):

```bash
radius deploy
radius deploy --build <build-digest>
radius deploy --environment staging
radius deploy --organization acme --environment staging
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

Promotion and rollback never rebuild. They update desired deployment state
with an expected revision so concurrent operators cannot silently overwrite
one another.

## Version and compatibility contract

- The CLI, build package, and public agent contracts release as one compatible
  toolchain line.
- The runtime SDK may evolve independently within declared compatibility
  ranges.
- `build` and `deploy` detect mismatched Radius package versions and fail with
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
- Live development is visibly distinct from microVM build verification.
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
