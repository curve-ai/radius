# ADR-005: Separate pluggable sync capability from operated sync services

**Status:** Superseded in part by ADR-009
**Date:** 2026-08-21
**Deciders:** Radius maintainers

## Context

Radius is useful without an account or network connection and owns the
canonical local copy of sessions, approvals, tool history, schedules,
artifacts, and audit records. Some users will want the same data available on
other devices or in a hosted product, while people cloning Radius may want no
sync at all or may want to operate their own compatible service.

Making Curve Cloud the storage layer would break local-first operation. Keeping
all sync code private would prevent community builds from using a compatible
self-hosted service. Connecting the desktop directly to a remote database would
expose database credentials, couple the client to one physical schema, and move
authorization into an inspectable endpoint.

## Decision

Radius owns the optional sync capability and public contracts. Operated sync
services and provider-specific authorization remain outside Radius.

Radius will eventually provide:

- Local change capture coordinated transactionally with local persistence.
- A versioned, storage-independent sync protocol.
- A provider interface for push, pull, acknowledgements, capabilities, status,
  and revocation.
- Retry, cursor, deduplication, compatibility, and recovery behavior.
- Local-first behavior, import/export, and observable sync status.
- A way for trusted builds or extensions to register a compatible provider.
- Sync health that does not occupy normal workspace navigation or Settings.

Radius will not require a Cloud account, Turso account, or raw remote database
credential. ADR-009 requires each desktop bundle to target one Radius Platform,
defaulting to the open local self-host at `http://localhost:3100/`.

Curve Cloud will eventually own its private desktop provider, authenticated
sync API, user and device registration, tenant policy, remote projections,
artifact storage, server-side audit evidence, operations, and support. A
self-hosted service may implement the same public protocol using any storage
engine.

The supported extension point is a sync service or trusted provider adapter,
not an agent-supplied database connection string. A direct Turso adapter may be
offered for advanced single-user deployments, but it is not the core contract.

## Options considered

### Public sync core with external providers

**Advantages**

- Preserves local-only operation.
- Gives clones a documented self-hosting path.
- Keeps local change capture close enough to persistence to be atomic.
- Allows Cloud and community services to evolve behind one public contract.

**Costs**

- Requires protocol versioning and conformance tests.
- Limits provider-specific behavior to negotiated capabilities.
- Makes compatibility and conflict semantics public product commitments.

### Private sync client in the official application only

This is simpler initially, but it makes the public application an incomplete
shell and prevents community providers from integrating without patching the
desktop. Rejected.

### Required managed Turso synchronization

This reduces custom infrastructure but requires a hosted dependency, couples
the public contract to one vendor, and conflicts with the optional Cloud
boundary. Rejected as the core design.

### Keep all synchronization outside the desktop

An external process cannot reliably coordinate each local mutation with the
sync outbox or surface clear status and conflicts in the product. Rejected.

## Consequences

- Sync protocol and core packages belong in Radius; Curve-specific providers
  and server implementation belong in Cloud.
- Community builds target the local self-hosted Radius Platform by default.
- Self-hosters embed a compatible Platform endpoint in the desktop bundle; they
  do not expose a database directly to the desktop.
- The first synchronized record model, persistence changes, and migrations
  require a separate logical-schema review and explicit approval.
- A public reference self-hosted server may be added later in a separate
  repository without changing the desktop contract.

## Validation

1. Run every local workflow against the default local Platform with no Cloud
   dependency.
2. Exercise the same protocol against Curve Cloud and a minimal independent
   conformance service.
3. Verify duplicate delivery, interruption, retry, revocation, incompatible
   versions, conflicts, and partial failures.
4. Verify renderer and agent processes never receive provider secrets or raw
   database access.
5. Verify interrupted sync leaves canonical local data intact and exportable.
