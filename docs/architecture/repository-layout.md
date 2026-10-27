# Repository ownership

Radius is a Bun workspace containing applications and reusable TypeScript
packages. The parent workspace and private Cloud repository are separate.

## Applications and libraries

`apps/` owns executable applications and their local tooling. `packages/`
owns libraries with explicit APIs or independent build/release boundaries.
`examples/` demonstrates official ACP SDK authoring. `hosting/` owns the
self-host distribution; PostgreSQL uses the pinned official image directly.

The root commands use Turbo to schedule and cache JavaScript workspace tasks.
Bun remains the package manager and script runtime; package manifests own task
implementations and dependencies. Native runtime,
Python, hosting, and integration operations are run from their component.

## Package boundary review

| Packages                                  | Consumers or reason for a separate boundary                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `agent-contracts`, `agent-build`, `cli`   | Shared configuration plus independently installable build/CLI tooling                           |
| `platform-contracts`, `platform-client`   | API, desktop, dashboard, CLI, and database consumers                                            |
| `platform-database`, `platform-providers` | Shared by API and worker                                                                        |
| `platform-job-contracts`                  | Queue wire format, kept separate from worker implementation                                     |
| `runtime`                                 | Desktop, CLI, and optional agent development/authentication adapters                            |
| `connector-protocol`, `mcp-connector`     | Shared connector schemas and MCP integration used by storage/tool broker/desktop                |
| `storage`                                 | Desktop, scheduler, and sync engine                                                             |
| `sync-protocol`                           | API, storage, and sync engine                                                                   |
| `scheduler`, `sync-core`, `tool-broker`   | Tested stateful subsystems with explicit storage, synchronization, and authorization interfaces |

The former `packages/sdk` callback framework and first-party Python SDK were
removed in favor of official ACP SDKs. The remaining packages have meaningful
library or contract boundaries; this cleanup does not merge unrelated domains
merely to reduce the directory count.

## Procedures and local state

Component setup/build/release/test tools are tracked beside their owner. Only
cross-package npm release staging remains in `scripts/release/`. The ignored
`.scratch/` directory is for temporary investigations and personal utilities.
Generated output, caches, credentials, and populated environment files remain
ignored. See [contributing](../../CONTRIBUTING.md) for command and environment
ownership.
