# Radius Platform PostgreSQL architecture

**Status:** Approved and implemented foundation
**Date:** 2026-08-25

## Mission

The Radius Platform database maintains authentication, tenant membership,
project-as-agent release and deployment state, assignments, device
observations, policies, optional workspace sync, connector intent, connector
discovery, and audit evidence for managed and self-hosted installations.

It is separate from the desktop's embedded libSQL database. A self-hosted
Platform never requires Curve Cloud for correctness.

## Decisions

- PostgreSQL 18.6 is pinned from the official Bookworm image by digest.
- No PostgreSQL extensions or Supabase platform services are included.
- Drizzle owns the versioned schema and migrations.
- Better Auth uses PostgreSQL tables in the `auth` schema.
- Tenant, sync, connector, and audit subjects occupy separate schemas.
- Every project is exactly one agent. A synced local folder is a
  `sync.workspace_project`, not a Platform project.
- Redis and BullMQ remain retryable job infrastructure rather than the durable
  business-data authority.
- RLS is defense in depth. Runtime roles do not own tables and must set
  transaction-local account and organization context.
- Release, deployment-revision, policy-revision, and audit history is
  append-only to runtime roles.
- Secret bytes stay in a secret manager; the database stores scoped references.

## Deletion

Tenant, membership, project, release, deployment, device, policy, credential,
and audit relationships default to restrict or explicit revocation. Ephemeral
authentication/session data may cascade with the Better Auth user identity.
Connector-source deletions and sync deletions remain tombstones so clients can
reconcile them.

## Distribution

`packages/platform-database` contains the schema, migrations, and database
client. `hosting/postgres` contains the digest-pinned image, role bootstrap,
loopback-only Compose service, and empty extension allowlist.
