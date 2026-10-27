# Radius

Radius is an open-source desktop runtime and delivery platform for specialized
AI agents. It includes an Electron workspace, local execution, permissioned
tools, durable sessions, and a self-hostable management plane.

Agent authors use the official [Agent Client Protocol SDKs](https://agentclientprotocol.com).
Radius owns installation, execution, packaging, and deployment; agents own their
model and reasoning loop.

## Local development

Use the Bun version pinned in `package.json`, Node.js 22.12 or newer, and Docker
Compose (or your own PostgreSQL, Redis/Valkey, and OCI registry).
The macOS runtime requires Apple Silicon, macOS 26, and Xcode 26.2.
Python tooling is only needed for Python agents.

```sh
bun install --frozen-lockfile
cp .env.example .env.local
cp apps/platform-api/.env.example apps/platform-api/.env.local
cp apps/platform-web/.env.example apps/platform-web/.env.local
# Configure an email provider in apps/platform-api/.env.local.
bun run --cwd hosting infra:up
# Separate terminals:
bun run dev:platform
bun run --cwd apps/platform-jobs dev:local
bun run --cwd apps/platform-web dev:local
bun run dev
```

See [local development](docs/guides/local-development.md) for email setup,
existing databases, authentication, ports, and shutdown.

## Repository map

| Directory | Ownership |
| --- | --- |
| `apps/` | Desktop, browser integration, native host, and Platform services |
| `packages/` | Reusable runtime, storage, contracts, tools, build system, and CLI |
| `examples/` | Agents authored directly with official ACP SDKs |
| `hosting/` | Self-host Compose distribution and its verification tooling |
| `scripts/release/` | Cross-package npm release tooling |
| `docs/` | Architecture, contributor guides, and self-hosting |

The private Curve Cloud service is maintained separately and is not required
to use or contribute to Radius.

## Development commands

`bun run build`, `test`, `typecheck`, and `lint` delegate to the owning
JavaScript workspace projects through Turbo. `bun run ci:verify` schedules and
caches the CI checks together. Run a focused command with
`bun run --cwd <app-or-package> <command>`.
`bun run package` prepares the native/browser assets and an unpacked desktop;
`bun run make` prepares desktop installers.

- [Contributing and task ownership](CONTRIBUTING.md)
- [Agent authoring and CLI](docs/architecture/agent-sdk-and-cli.md)
- [Architecture](docs/architecture/README.md)
- [Self-hosting](docs/self-hosting/README.md)
- [Desktop testing](docs/guides/desktop-testing.md)
- [Company sign-in](docs/guides/vendor-authentication.md)
- [npm release tooling](docs/architecture/npm-package-release.md)

## License

Radius source is available under the [MIT License](LICENSE).
