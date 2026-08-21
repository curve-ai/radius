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
- Public security model and architecture decisions.

Operated services, business strategy, private vendor integrations, marketplace economics, and internal delivery plans are outside this repository.

## Development

Requirements:

- Node.js 22 or newer.
- npm 10.

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm run lint
npm run package
```

The current desktop shell uses macOS vibrancy when available and keeps Node.js disabled in the renderer. Privileged APIs must be exposed through narrow preload contracts.

## Architecture

Start with [the architecture index](docs/architecture/README.md). The accepted decisions cover local-first execution, OCI agent packages, the vendor-owned agent loop, capability brokering, and the security boundary.

## Contributing

Radius is early. Open an issue before starting a substantial feature so protocol and security changes can be discussed first. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

Radius is available under the [MIT License](LICENSE).
