# Radius

Radius is an open-source desktop runtime and delivery platform for specialized
AI agents. It gives developers a reusable Electron client, local runner,
permissioned tools, SDK and CLI, immutable packaging and deployment contracts,
durable sessions, and a self-hostable management plane without taking
ownership of their model or reasoning loop.

> **Status:** pre-alpha architecture and desktop shell. Radius is not ready to run untrusted agent packages.

## What belongs here

- Electron desktop host and React workspace.
- Local agent runtime and lifecycle management.
- Versioned package, event, capability, and artifact protocols.
- Permission and approval broker.
- Host-managed shell and MCP integrations.
- Vendor SDKs and reference packages.
- Developer CLI for repository initialization, local execution, package upload,
  deployment, promotion, and rollback.
- Open customer dashboard, control-plane API, deployment workers, and
  self-hosting assets.
- Optional, provider-neutral synchronization contracts and local-only defaults.
- Durable local schedules with persisted missed-run and dispatch recovery.
- Public security model and architecture decisions.

Curve-specific operated infrastructure, marketing, private integrations,
marketplace economics, customer details, and internal delivery plans are
outside this repository.

## Development

Requirements:

- Bun 1.3.14 or newer.
- Node.js 22 or newer.
- uv 0.8.22 or newer for Python SDK and Python-agent development.
- Xcode 26.2 or newer when building the bundled macOS runtime host.
- Apple Silicon and macOS 26 or newer when running local agent packages.

```bash
bun install
bun run browser:build
bun run dev
```

To run the durable open Platform management plane, start the complete
single-node development stack:

```bash
bun run platform:stack:up
```

This applies approved, checksummed PostgreSQL migrations under an advisory
lock, bootstraps a local development authority, persists immutable agent
deployments and environment history, and dispatches the transactional outbox
through BullMQ.
Open `http://127.0.0.1:3200`; the local token is `radius-dev-token` unless
overridden before startup.

For first-run ownership without the development fixture, use the
[one-time operator bootstrap](docs/self-hosting/README.md#initial-owner-bootstrap).
Owners can then rotate scoped deployment credentials through `radius tokens
list|create|revoke` without direct database access.
`radius login --profile <name>` validates a token and stores it in the native
operating-system credential manager; `radius logout` removes it. CI continues
to use `RADIUS_ACCESS_TOKEN` as an explicit override.

With browser-session authentication configured, the open dashboard provides
the same token lifecycle in Settings and revision-checked Promote or Roll back
controls on verified agent deployments. The UI follows organization membership
roles and does not place a Platform service token in the browser.

The API and web application are documented in
[`apps/platform-api/README.md`](apps/platform-api/README.md) and
[`apps/platform-web/README.md`](apps/platform-web/README.md).

To verify or stage the externally installable TypeScript SDK/CLI release set
without publishing it:

```bash
bun run release:npm:verify
bun run release:npm:pack
bun run release:python:verify
```

See the [npm release boundary](docs/architecture/npm-package-release.md).
The [Platform image release boundary](docs/architecture/platform-container-release.md)
defines the coherent signed GHCR image set and released/source Docker Compose
modes.

To prove the production-oriented single-node self-host path with disposable
volumes, authenticated TLS routing, a real CLI deployment, worker verification,
and paired database/registry recovery:

```bash
bun run platform:self-host:verify
```

The container release boundary has a separate multi-architecture artifact
check:

```bash
bun run release:platform-images:verify
```

To build and run the complete current single-node container stack:

```bash
bun run platform:stack:up
```

This remains a development profile with local fixture credentials, not a
production deployment. See the [self-hosting guide](docs/self-hosting/README.md)
for the current boundary.

For authenticated browser development, open Chrome's extensions page, enable
Developer mode, and load `apps/browser-extension/dist` as an unpacked
extension. Radius registers its per-user native-messaging host when the desktop
starts. The Apps & connections settings section reports the live profile
connection and reveals the built extension directory.

Useful checks:

```bash
bun run typecheck
bun run lint
bun run test
bun run runtime:test
bun run runtime:build
bun run sdk:python:test
bun run sdk:python:lint
bun run package
```

The current desktop shell uses macOS vibrancy when available and keeps Node.js disabled in the renderer. Privileged APIs must be exposed through narrow preload contracts.

Desktop development and packaged smokes use the normal Radius Application
Support profile by default. See the
[desktop testing profile guide](docs/guides/desktop-testing.md) before using
`RADIUS_USER_DATA_PATH` or cloning encrypted local state.

## Desktop updates

Packaged Radius clients check the public `curve-ai/radius` GitHub Releases feed
at startup and every four hours. When a newer signed release is available, the
sidebar account row shows a download action. After download, the same action
restarts Radius and installs the update.

Release builds must be signed; macOS will not apply unsigned updates. Build and
publish the platform artifacts plus update metadata with electron-builder, for
example from a release runner configured with `GH_TOKEN` and the platform code
signing credentials:

```bash
bun run --cwd apps/desktop make -- --publish always
```

Development and unpacked directory builds intentionally do not check for
updates.

## Architecture

Start with [the architecture index](docs/architecture/README.md). The accepted
decisions cover local-first execution, OCI agent packages, the vendor-owned
agent loop, local persistence, durable local scheduling, optional
provider-based sync, capability brokering, and the security boundary. The
proposed [SDK and CLI contract](docs/architecture/agent-sdk-and-cli.md) covers
the implemented `init` → `dev` → `deploy` developer loop. TypeScript and Python
now have first-party SDK paths, while ACP and OCI keep other-language agents
compatible with the same package and deployment contracts. If you are
cloning Radius and want to connect your own service, read the
[sync-provider implementation guide](docs/guides/sync-provider.md).

## Contributing

Radius is early. Open an issue before starting a substantial feature so protocol and security changes can be discussed first. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

Radius is available under the [MIT License](LICENSE). Third-party
components retain their own licenses and
[notices](THIRD_PARTY_NOTICES.md).
