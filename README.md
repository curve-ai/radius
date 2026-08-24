# Radius

Radius is an open-source desktop host for specialized AI agents. It gives agent developers a reusable Electron client, a local runtime boundary, permissioned tools, durable sessions, and typed artifacts without taking ownership of their model or reasoning loop.

> **Status:** pre-alpha architecture and desktop shell. Radius is not ready to run untrusted agent packages.

## What belongs here

- Electron desktop host and React workspace.
- Local agent runtime and lifecycle management.
- Versioned package, event, capability, and artifact protocols.
- Permission and approval broker.
- Host-managed shell and MCP integrations.
- Vendor SDKs and reference packages.
- Optional, provider-neutral synchronization contracts and local-only defaults.
- Durable local schedules with persisted missed-run and dispatch recovery.
- Public security model and architecture decisions.

Operated services, business strategy, private vendor integrations, marketplace economics, and internal delivery plans are outside this repository.

## Development

Requirements:

- Bun 1.3.14 or newer.
- Node.js 22 or newer.

```bash
bun install
bun run dev
```

Useful checks:

```bash
bun run typecheck
bun run lint
bun run test
bun run package
```

The current desktop shell uses macOS vibrancy when available and keeps Node.js disabled in the renderer. Privileged APIs must be exposed through narrow preload contracts.

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

Start with [the architecture index](docs/architecture/README.md). The accepted decisions cover local-first execution, OCI agent packages, the vendor-owned agent loop, local persistence, durable local scheduling, optional provider-based sync, capability brokering, and the security boundary. If you are cloning Radius and want to connect your own service, read the [sync-provider implementation guide](docs/guides/sync-provider.md).

## Contributing

Radius is early. Open an issue before starting a substantial feature so protocol and security changes can be discussed first. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

Radius is available under the [MIT License](LICENSE).
