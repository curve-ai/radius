# Radius Platform database

This package owns the public PostgreSQL schema, migrations, and client factory
for the self-hosted Radius Platform. It does not own the desktop's embedded
libSQL database.

The database is split into explicit schemas:

- `auth`: Better Auth identity, session, verification, JWT, and rate-limit data.
- `platform`: organizations, projects/agents, releases, deployments, devices,
  assignments, policy, and credential-reference metadata.
- `sync`: account-scoped optional Radius workspace synchronization.
- `connectors`: global connector discovery plus account-scoped connector intent.
- `audit`: append-only organization and deployment evidence.

Platform projects are agents. Synced local folders are deliberately named
`workspace_projects` so the two identities cannot be confused.

All tenant-owned relations carry `organization_id` and use same-organization
foreign keys where relationships cross tables. Account-scoped sync and
connector records use `account_id`. Runtime database roles are non-owners and
row-level security defaults to denying access unless the API sets the matching
transaction-local context.

`platform.accounts`, `platform.organizations`, and
`platform.organization_domains` are routing/identity lookup tables and are the
deliberate RLS exceptions. They expose no secret bytes; repositories must still
limit their selected columns. All tenant resource tables remain default-deny.

Audit subject identity is the one deliberate polymorphic exception. Audit rows
must survive subject retirement or deletion, so `subject_kind` and
`subject_id` are immutable evidence rather than cascading foreign keys.

Raw secrets and artifact bytes are never stored here. Tables contain scoped
secret-manager references and immutable registry/object-storage identifiers.
