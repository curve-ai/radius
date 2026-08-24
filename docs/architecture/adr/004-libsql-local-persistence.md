# ADR-004: Use embedded libSQL for Radius local persistence

**Status:** Accepted
**Date:** 2026-08-21
**Deciders:** Radius maintainers

## Context

Radius owns durable local sessions, progress events, approvals, tool history,
agent state, schedules, artifact metadata, and exportable audit records. The
desktop must remain useful without a Cloud account or network connection, while
leaving room for optional hosted synchronization and encryption at rest.

The local store needs transactional writes, a portable single-file format,
typed TypeScript access, reviewable migrations, and practical Electron
packaging. It must not require a separately installed database server.

## Decision

Radius will use embedded libSQL as its local operational database and Drizzle
as its TypeScript schema, query, and migration-generation layer.

- The database runs locally and remains authoritative for Radius-owned data.
- Local reads and writes do not require a Cloud account or network connection.
- A host-owned storage service is the only database writer. The renderer and
  vendor agent containers do not receive the database path or raw connection.
- Encryption at rest is configured by the host, with key material stored in the
  operating-system credential store.
- Drizzle Kit may generate reviewable SQL during development. Shipped clients
  apply bundled, versioned migrations through Radius-owned startup and recovery
  logic; they never run schema-push tooling.
- Cloud synchronization is a separate, optional provider contract over
  versioned application records. Selecting libSQL does not require Turso or
  make database-file replication the public sync protocol.
- Large artifacts remain content-addressed files with metadata in libSQL.
  Vendor-authorized analytical datasets may use a separate DuckDB or equivalent
  store when appropriate.

## Options considered

### SQLite through Node's built-in driver

This has a small dependency surface and avoids a separate native addon, but it
does not provide the selected encryption and future synchronization path by
itself.

### SQLite with a SQLCipher-capable driver

This provides mature encrypted SQLite semantics, but adds native Electron build
and distribution work. It remains a fallback if libSQL packaging or encryption
does not validate on supported platforms.

### Turso as a required hosted primary

Rejected for the Radius core. Managed sync could reduce implementation effort,
but requiring a hosted account would violate independent local operation.
Turso may later be implemented by an optional Cloud provider.

### Local MongoDB

Rejected. Shipping and supervising a database server would add installation,
upgrade, resource, port, repair, and security responsibilities that are not
justified for the desktop operational store.

## Consequences

- The first storage implementation must validate libSQL and encryption in
  packaged macOS and Windows Electron builds before external distribution.
- Schema migrations become part of the desktop release and recovery contract.
- The public storage package should keep libSQL-specific details behind a narrow
  repository interface so the engine can be replaced without changing Radius
  protocols.
- Remote MongoDB or other Cloud storage remains an independent projection and
  control-plane concern rather than a mirror of the local database file.

## Validation

1. Verify create, reopen, transactional recovery, backup, and migration paths.
2. Verify encrypted storage and operating-system key retrieval.
3. Package, install, and upgrade representative databases on supported macOS
   and Windows architectures.
4. Confirm the application starts and remains writable while fully offline.
5. Confirm renderer and agent processes cannot open the database directly.
