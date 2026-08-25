# Radius architecture

Radius is a local-first desktop host for vendor-owned AI agents. The host provides a consistent user experience and mediates access to operating-system capabilities; agent vendors retain their models, prompts, domain tools, data services, and reasoning loops.

## System boundary

```text
Radius desktop
├── React renderer
│   └── sessions, approvals, progress, and artifacts
├── Electron host
│   └── windows, notifications, credentials, and signed IPC
├── capability broker
│   └── files, shell, MCP tools, and audit events
└── managed local runtime
    └── signed OCI agent package
        ├── vendor-owned agent loop
        └── structured capability requests
```

The React renderer is unprivileged. Electron owns operating-system integration but does not perform long-running agent work. Agent execution belongs in a supervised local runtime so CPU, filesystem, and container work cannot block the UI process.

## Accepted direction

- Execute agents locally when proximity to user files and tools is valuable.
- Package Python and TypeScript agents as signed, multi-architecture OCI images.
- Keep model selection and the reasoning loop vendor-owned.
- Expose host capabilities through a typed broker; never mount broad host resources directly into an agent container.
- Standardize events, capabilities, permissions, artifacts, cancellation, and provenance rather than agent personas.
- Keep the public protocol versioned and portable.
- Store Radius-owned operational data in an encrypted embedded libSQL database
  without requiring Cloud connectivity.
- Keep synchronization optional and expose it through public, storage-neutral
  provider contracts rather than a required hosted service.

## Decision records

- [`adr/001-local-first-execution.md`](adr/001-local-first-execution.md) — execute the first agent on the user's desktop.
- [`adr/002-oci-agent-packages.md`](adr/002-oci-agent-packages.md) — distribute local agents as signed OCI images.
- [`adr/003-vendor-owned-agent-loop.md`](adr/003-vendor-owned-agent-loop.md) — preserve the vendor's agent loop.
- [`adr/004-libsql-local-persistence.md`](adr/004-libsql-local-persistence.md) — persist Radius-owned data in embedded libSQL through a host-owned storage service.
- [`adr/005-pluggable-optional-sync.md`](adr/005-pluggable-optional-sync.md) — separate the public sync capability from operated provider services.
- [`adr/006-durable-local-scheduling.md`](adr/006-durable-local-scheduling.md) — persist schedules and leased dispatch state in local libSQL.
- [`adr/007-one-root-projects.md`](adr/007-one-root-projects.md) — group sessions under one explicit local root folder and enforce recursive containment.

## Supporting architecture

- [`upstream-desktop-ui-provenance.md`](upstream-desktop-ui-provenance.md) — copied
  dashboard styles/primitives, Electron adaptations, and repository boundary.
- [`security-model.md`](security-model.md) — trust boundaries, permissions, credentials, and runtime hardening.
- [`tool-broker-and-mcp.md`](tool-broker-and-mcp.md) — host-managed shell and MCP execution.
- [`capability-authorization-logical-model.md`](capability-authorization-logical-model.md)
  — proposed normalized package-request, provider, policy, run-resolution, and
  approval model; implementation is not yet approved.
- [`sync-v1-data-model.md`](sync-v1-data-model.md) — accepted typed local schema, public envelope, artifact model, authority rules, and migration plan.
- [`../guides/sync-provider.md`](../guides/sync-provider.md) — implement a compatible service and connect a cloned Radius application.
- [`platform-postgresql.md`](platform-postgresql.md) — approved PostgreSQL
  system of record for the self-hosted Platform, including tenancy, Better
  Auth, sync, connectors, RLS, and the pinned minimal distribution.

## Repository shape

```text
apps/desktop          Electron host and React renderer
packages/protocol     Versioned package and event contracts (planned)
packages/runtime      Supervised local agent runtime (planned)
packages/tool-broker  Capability policy and host tools (planned)
packages/sdk          Vendor integration SDK (planned)
packages/storage      Embedded libSQL persistence and migrations
packages/sync-protocol Versioned provider-neutral sync contracts
packages/sync-core    Optional sync lifecycle, HTTP provider, and recovery
packages/scheduler    Durable local recurrence, recovery, and dispatch coordination
packages/platform-database PostgreSQL schema and migrations for the self-hosted Platform
hosting/postgres       Pinned PostgreSQL image and single-node self-host service
docs/architecture     Public technical decisions
```

Business strategy, operated services, private integrations, and internal delivery plans are intentionally outside this repository.
