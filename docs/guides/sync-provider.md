# Implement and connect an optional Radius sync provider

This guide is for people cloning Radius who want to keep it local-only, connect
it to their own service, or integrate an operated provider. The typed protocol,
local storage, sync core, signed HTTP provider, and guarded Curve Cloud service
exist; Electron's isolated Better Auth sign-in flow exists, while the renderer
Settings surface exposes only an opt-in switch and provider setup.

## Start here

Radius must work without sync. The target community-build contract is:

```text
local database       enabled
local workflows      enabled
import and export    available
sync                  disabled
Cloud account         not required
```

Radius owns local change capture and the public provider contract. A remote
service owns authentication, authorization, shared ordering, remote storage,
and operations. Read
[`ADR-005`](../architecture/adr/005-pluggable-optional-sync.md) for the decision
and [`ADR-004`](../architecture/adr/004-libsql-local-persistence.md) for the
local persistence boundary.

Do not connect a cloned desktop directly to PostgreSQL or another raw
database. Put an authenticated sync service in front of the store, or install a
trusted provider adapter designed for a narrow single-user deployment.

## Component boundary

```text
Radius renderer
    │ typed status and settings IPC
    ▼
Electron host
    ├── provider registry and credential handle
    └── sync core
          ├── retry and compatibility policy
          ├── push and pull coordination
          └── storage-owned change capture
                    │
                    │ versioned public protocol
                    ▼
          compatible sync service
          ├── identity and device authorization
          ├── idempotency and ordering
          ├── remote projections
          ├── artifact storage
          └── server audit evidence
```

Public package responsibilities:

```text
packages/storage        local libSQL ownership and atomic change capture
packages/sync-protocol  versioned provider-neutral contracts
packages/sync-core      provider lifecycle, retry, cursors, and status
apps/desktop            opt-in configuration and safe status UI
```

An official managed build may register a private Curve Cloud provider. Radius
must not import that package, and the community build uses local/no-op behavior
when no provider is configured.

## Provider contract

The TypeScript interface is intentionally small and storage-independent. Its
source is `packages/sync-core/src/provider.ts`:

```ts
interface SyncProvider {
  describe(): Promise<ProviderCapabilities>;
  connect(context: ProviderContext): Promise<SyncConnection>;
  push(request: PushRequest): Promise<PushResult>;
  pull(request: PullRequest): Promise<PullResult>;
  status(): Promise<ProviderStatus>;
  disconnect(): Promise<void>;
}
```

The public protocol should describe application records and changes, not SQL,
libSQL pages, database-native documents, or Turso WAL frames. Providers may use any
physical store behind their service.

The contract must support:

- Explicit protocol and capability negotiation.
- Stable change identifiers and idempotent acknowledgement.
- Ordered pagination through opaque cursors.
- Structured rejection and conflict results.
- Credential expiry and device revocation.
- Optional artifact-transfer negotiation.
- Observable last-attempt, last-success, pending, and error state.

Exact synchronized record types, fields, conflict rules, and persistence tables
must be designed separately. Follow the repository's schema-review rule before
adding Drizzle definitions, DDL, indexes, migrations, backfills, or Cloud
projections.

## How the desktop connects

### 1. Leave sync disabled

Do nothing. This is the default and must remain a supported configuration.
Local writes, schedules, artifacts, history, import, and export continue to
work.

### 2. Choose a trusted provider

A distribution or approved extension registers a provider with the Electron
host. Provider code runs on the trusted side of the renderer boundary; vendor
agent packages cannot register providers or choose endpoints silently.

The desktop should expose only non-secret settings such as provider identity,
endpoint label, connection state, and selected data scope. Credential material
belongs in the operating-system credential store and is referenced by an opaque
handle.

### 3. Pair or authenticate

Use a browser-based or device-code flow when possible. The provider returns a
short-lived, user- and device-scoped credential. Never ask a user to paste a
master database password into Radius.

### 4. Validate before enabling

Before the first push, the host verifies:

- Endpoint transport and expected provider identity.
- Protocol-version compatibility.
- Required and optional capabilities.
- Current user, device, and requested data scope.
- Revocation and sign-out behavior.

The user sees the scope and explicitly enables sync. Connection success must not
change which local workflows are available.

### 5. Run in the background

The storage service records a local mutation and its pending sync change in one
transaction. The sync core sends pending changes, records acknowledgements,
pulls remote changes, validates them, and asks storage to apply them. The
renderer receives status through narrow IPC and never reads the database or
provider credential directly.

Network loss is expected. Local work continues, pending changes remain durable,
and the core retries with bounded backoff. Disabling or signing out of sync
stops transfer without deleting canonical local data.

## Implement a compatible service

A self-hosted service may use Turso, PostgreSQL, object storage, or a
different backend. Storage choice is private to the service. It must implement
the published protocol rather than expose its database wire protocol.

At minimum, the service needs to provide:

1. Provider metadata and supported protocol versions.
2. User and device authentication with revocation.
3. Authorized, idempotent push processing.
4. Cursor-based pull processing.
5. Deterministic conflict and rejection responses.
6. Retention and deletion behavior.
7. Health, audit, and operational visibility.

For artifacts, return scoped upload/download instructions rather than routing
large files through the record endpoint. Verify content hashes on both sides.

Do not promise multi-device merge behavior until each mutable record type has an
approved conflict policy. Append-only records, editable metadata, schedules,
deletion tombstones, and binary artifacts have different requirements.

## Configuration shape

The current developer connection path is opt-in through Electron-main-process
environment variables:

```text
RADIUS_SYNC_ENDPOINT=https://example.test/api/sync/v1/
RADIUS_SYNC_TOKEN=<short-lived Better Auth JWT>
```

The token never crosses the preload boundary. This environment path is for
development and self-host conformance, not the final sign-in UX. A future
provider registry should express intent without embedding credentials and may
resemble:

```json
{
  "sync": {
    "enabled": true,
    "provider": "example-http-provider",
    "endpoint": "https://sync.example.test",
    "credentialHandle": "os-credential-reference"
  }
}
```

Do not treat this example as a committed configuration schema.

## Implementation sequence

1. **Done:** approve the typed synchronized-data model and invariants.
2. **Done:** define the versioned public protocol and compatibility policy.
3. **Done:** implement atomic local change capture and the initial migration.
4. **Done:** implement sync-core retry, cursor, acknowledgement, and status.
5. **Done:** add signed HTTP provider wiring and narrow status/run-now IPC.
6. **Done:** implement guarded Curve Cloud routes and typed Drizzle PostgreSQL projections.
7. **Done:** Electron authentication and token refresh are implemented;
   the renderer invokes them from its deep Settings surface.
8. **Done:** implement optional content-addressed file upload/download.
9. **Later:** publish an independent conformance service or reference server.

No step may generate or apply a schema or migration until its exact design has
completed the repository's approval process.

## Verification matrix

Every provider should pass the same conformance scenarios:

- No provider and no network: the entire local product remains usable.
- First connection and reconnect after restart.
- Network interruption during push and pull.
- Duplicate delivery and duplicate acknowledgement.
- Partial batch rejection without losing accepted work.
- Expired and revoked credentials.
- Unsupported protocol version and capability mismatch.
- Malformed or unauthorized remote changes.
- Concurrent updates with a deterministic, visible result.
- Large artifact interruption, resume, and hash mismatch.
- Provider disablement, sign-out, local export, and local recovery.
- Upgrade from every supported local schema and protocol version.

## Contribution boundary

Changes to the public sync protocol, storage coordination, or provider
interface start in Radius as an architecture proposal. Curve-specific identity,
private Cloud projections, billing, organization policy, operated infrastructure, and
support tooling stay outside Radius.

Never include production endpoints, credentials, private schemas, customer
data, or proprietary provider code in a Radius contribution.

## Product UI boundary

Sync is deliberately absent from normal workspace chrome. Do not add sidebar
status lights, activity-feed entries, first-run prompts, or global error badges.
Settings contains the enable switch, provider configuration, and provider-local
errors.
