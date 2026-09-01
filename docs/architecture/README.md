# Radius architecture

Radius is a local-first desktop runtime and open delivery platform for
developer-owned AI agents. The desktop provides a consistent user experience
and mediates access to operating-system capabilities; the SDK, CLI, and
self-hostable control plane package and distribute agents; developers retain
their models, prompts, domain tools, data services, and reasoning loops.

## System boundary

```text
Radius desktop
├── React renderer
│   └── sessions, approvals, progress, and artifacts
├── Electron host
│   └── windows, notifications, credentials, and signed IPC
├── capability broker
│   └── files, shell, MCP tools, and audit events
└── signed native runtime helper
    └── one workspace-owned microVM per signed OCI agent package
        ├── vendor-owned agent loop
        └── structured capability requests
```

The React renderer is unprivileged. Electron owns operating-system integration but does not perform long-running agent work. Agent execution belongs in a supervised local runtime so CPU, filesystem, and container work cannot block the UI process.

## Accepted direction

- Execute agents locally when proximity to user files and tools is valuable.
- Package Python and TypeScript agents as signed OCI images and run each one in
  a self-contained workspace-owned microVM.
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
- [`adr/002-oci-agent-packages.md`](adr/002-oci-agent-packages.md) — distribute local agents as signed OCI images and run them in workspace-owned microVMs.
- [`adr/003-vendor-owned-agent-loop.md`](adr/003-vendor-owned-agent-loop.md) — preserve the vendor's agent loop.
- [`adr/004-libsql-local-persistence.md`](adr/004-libsql-local-persistence.md) — persist Radius-owned data in embedded libSQL through a host-owned storage service.
- [`adr/005-pluggable-optional-sync.md`](adr/005-pluggable-optional-sync.md) — separate the public sync capability from operated provider services.
- [`adr/006-durable-local-scheduling.md`](adr/006-durable-local-scheduling.md) — persist schedules and leased dispatch state in local libSQL.
- [`adr/007-one-root-projects.md`](adr/007-one-root-projects.md) — group sessions under optional local source folders and enforce recursive containment.

## Supporting architecture

- [`upstream-desktop-ui-provenance.md`](upstream-desktop-ui-provenance.md) — copied
  dashboard styles/primitives, Electron adaptations, and repository boundary.
- [`upstream-platform-ui-provenance.md`](upstream-platform-ui-provenance.md) —
  first-party management UI extraction, MIT authority, and explicit hosted
  infrastructure exclusions.
- [`security-model.md`](security-model.md) — trust boundaries, permissions, credentials, and runtime hardening.
- [`tool-broker-and-mcp.md`](tool-broker-and-mcp.md) — host-managed shell and MCP execution.
- [`browser-control.md`](browser-control.md) - authenticated Chrome and Edge
  control delegated to provided agents through the Radius browser broker.
- [`connector-registry-logical-model.md`](connector-registry-logical-model.md)
  — approved host-owned connector publication, installation, configuration,
  credential-reference, profile-sync, and discovered-binding model;
  implementation is in progress.
- [`capability-authorization-logical-model.md`](capability-authorization-logical-model.md)
  — approved normalized package-request, provider, policy, run-resolution, and
  approval model; implementation is in progress.
- [`agent-authentication-logical-model.md`](agent-authentication-logical-model.md)
  — proposed authority, device-local account, release-requirement,
  installed-agent binding, and portable profile-binding model; implementation
  is not yet approved.
- [`agent-sdk-and-cli.md`](agent-sdk-and-cli.md) — implemented SDK/configuration,
  local runner, profile, immutable deploy, promotion, rollback, compatibility,
  and developer security contract, including the implemented contracts, SDK,
  CLI, and TypeScript example foundation.
- [`npm-package-release.md`](npm-package-release.md) — release-unit graph,
  dist-only public staging, checksummed tarballs, and clean external install
  verification without registry publication.
- [`platform-container-release.md`](platform-container-release.md) — coherent
  four-image GHCR release unit, multi-architecture build, SBOM/provenance,
  keyless signing, draft release manifest, and source-versus-released Docker
  Compose boundaries.
- [`platform-jobs-and-providers.md`](platform-jobs-and-providers.md) — public
  job schemas, queue-independent provider contracts, BullMQ worker boundary,
  transactional outbox dispatch, retry rules, and remaining result-application
  work.
- [`platform-relational-logical-model.md`](platform-relational-logical-model.md)
  — approved normalized Platform subjects, keys, relationships, deletion
  rules, business invariants, and derived views.
- [`platform-postgres-v1-physical-model.md`](platform-postgres-v1-physical-model.md)
  — approved and active PostgreSQL 17 field/key/constraint/view translation of
  the core logical slice, with migration and local verification evidence.
- [`organization-users-v1.md`](organization-users-v1.md) — accepted simple
  company model: one organization, direct users through memberships, and
  organization-wide agents, with no additional schema.
- [`agent-deployments-and-installations-proposal.md`](agent-deployments-and-installations-proposal.md)
  — approved and implemented Platform vocabulary replacement for agent metadata,
  versioned deployments, physical devices, installed desktop clients, and
  installed agents.
- [`platform-versioning-and-cloud-migration.md`](platform-versioning-and-cloud-migration.md)
  — compatibility negotiation for mixed desktop/agent versions, credential
  custody, and passwordless self-hosted/Better Auth migration into Curve Cloud.
- [`platform-oidc-auth.md`](platform-oidc-auth.md) — provider-neutral OIDC
  Authorization Code + PKCE, allowlisted provisioning, hashed browser sessions,
  dashboard session integration, and role-aware organization administration.
- [`sync-v1-data-model.md`](sync-v1-data-model.md) — accepted typed local schema, public envelope, artifact model, authority rules, and migration plan.
- [`../guides/sync-provider.md`](../guides/sync-provider.md) — implement a compatible service and connect a cloned Radius application.
- [`../guides/bundling-fx.md`](../guides/bundling-fx.md) — prepare, package,
  and verify the built-in FX agent for the Apple Silicon desktop release.
- [`../../hosting/postgres/README.md`](../../hosting/postgres/README.md) — pinned
  official PostgreSQL base, empty-by-default extension authority, and image
  verification workflow used by the self-hosted Platform.
- [`../self-hosting/README.md`](../self-hosting/README.md) — Docker Compose
  installation, bootstrap, authentication, backup, restore, upgrade, and
  verification procedures.

## Repository shape

```text
apps/desktop          Electron host and React renderer
apps/browser-extension Manifest V3 bridge for authenticated Chrome and Edge tabs
apps/browser-native-host Chrome native-messaging relay into the Radius host
apps/runtime-host-macos Signed Apple Silicon/macOS 26 microVM helper
packages/browser-protocol Versioned native browser bridge messages
packages/browser-tools Run-scoped browser MCP provider
packages/agent-contracts Versioned manifest and agent configuration contracts
packages/runtime      ACP client and supervised microVM process sidecar
packages/tool-broker  Capability policy and host tools (planned)
packages/sdk          TypeScript ACP agent-authoring SDK foundation
sdks/python           Python ACP authoring SDK over the official Python package
packages/agent-build  Deterministic TypeScript and Python OCI build tooling
packages/cli          Init, native/sandbox dev, profiles, and dry-run deploy CLI
packages/platform-contracts Versioned public Platform HTTP and inventory contracts
packages/platform-client Validated Cloud/self-hosted HTTP client
packages/platform-job-contracts Versioned credential-free background job schemas
packages/platform-providers Queue-independent external-effect contracts
packages/platform-database Drizzle PostgreSQL models, migrations, relations, and locking
packages/storage      Embedded libSQL persistence and migrations
packages/sync-protocol Versioned provider-neutral sync contracts
packages/sync-core    Optional sync lifecycle, HTTP provider, and recovery
packages/scheduler    Durable local recurrence, recovery, and dispatch coordination
apps/platform-web     Open customer management dashboard for self-host and Cloud
apps/platform-api     Open compatibility/auth/deployment API with injected providers
apps/platform-jobs    BullMQ worker foundation and registry verification
examples/python-agent pyproject, uv, native, microVM, and deploy proof
hosting/docker        Full single-node Docker Compose stack
hosting/postgres      Verified official Postgres base and extension authority
docs/architecture     Public technical decisions
```

Curve-specific marketing, infrastructure operations, credentials, customer
details, and internal delivery plans remain outside this repository. The full
customer Platform and self-host implementation belong here and must depend only
on public contracts and injected providers.
