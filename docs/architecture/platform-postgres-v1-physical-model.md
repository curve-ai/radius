# Platform PostgreSQL v1 physical model

**Status:** Approved and active in the disposable local and self-host verification stacks

**Current approval:** 2026-08-27

**Approved migrations:** `packages/platform-database/drizzle/`

Drizzle Kit generates the relational core migration from the domain-split
schema modules. A checked-in custom Drizzle migration owns the PostgreSQL-only
append-only triggers, transition function, null-safe artifact constraint, and
derived views.

## Scope

The baseline is one company organization with users, agents, immutable agent
deployments, company devices, installed Radius clients, and observed agent
installations. It also contains the reliability records required to operate the
system safely: sessions, developer tokens, idempotency, an outbox, and audit
events.

The 22 domain tables are:

| Family                | Tables                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity              | `accounts`, `account_identities`, `platform_sessions`                                                                                        |
| Company access        | `organizations`, `organization_memberships`                                                                                                  |
| Developer access      | `developer_tokens`, `developer_token_scopes`, `developer_token_agents`                                                                       |
| Agent delivery        | `agents`, `agent_environments`, `agent_deployment_uploads`, `agent_deployments`, `agent_deployment_artifacts`, `agent_environment_revisions` |
| Managed installations | `physical_devices`, `client_installations`, `client_installation_observations`, `agent_installations`, `agent_installation_observations`     |
| Reliability and audit | `idempotency_records`, `job_outbox_messages`, `audit_events`                                                                                 |

Groups, per-user agent assignments, billing, hosted infrastructure, telemetry,
and arbitrary device-management payloads are absent.

## Physical rules

- All objects live in the `radius_platform` schema.
- UUIDs are application-generated. PostgreSQL extensions and database UUID
  generators are not required.
- Public references use `agent_...`; `project` remains a local desktop workspace
  concept only.
- Fixed protocol states use `text` with bounded `CHECK` constraints.
- External artifact digests retain the `sha256:` prefix. Existing raw build and
  bundle SHA-256 fields retain their 64-character lowercase representation.
- Browser sessions and developer-token values are stored only as SHA-256 hashes
  plus non-secret prefixes.
- Product rows never contain registry passwords, OIDC refresh tokens, device
  private keys, agent credentials, or connector credentials.
- Same-organization relationships use composite keys where two independent
  parents must agree on organization or agent ownership.

## Mutability and evidence

Agent deployment content is immutable. Its verification state may move only
forward from pending to verified or quarantined, then to revoked. Deployment
artifacts, agent environment revisions, client installation observations,
agent installation observations, and audit events reject update and delete.

Mutable identity and lifecycle subjects use database-managed `updated_at`
timestamps. Deactivation, suspension, and retirement preserve evidence instead
of cascading deletion.

Observation rows use a client-generated event UUID for retry safety and a
server receipt timestamp for auditability. The latest observation answers the
current desktop or agent version without a mutable duplicate version column.

## Delivery and compatibility

An agent deployment stores its minimum desktop version and required runtime
protocol. A client observation stores the actual desktop, runtime, and protocol
versions. An agent installation observation identifies the immutable deployment
actually installed.

When a desired deployment is incompatible, the client retains its last ready
compatible deployment and appends `blocked_incompatible` with a bounded reason
code. It does not rewrite the environment, the deployment, or a user-specific
assignment.

## Derived views

The baseline keeps four operational views that derive, rather than duplicate,
state:

- `current_agent_environment_deployments`;
- `organization_agent_inventory`;
- `agent_deployment_evidence`; and
- `ready_job_outbox`.

No device, desired/current, drift, or installation-history view was added.
Installation queries select the latest append-only observation directly.

## Transaction boundaries

- Environment changes lock the environment, compare the expected revision, and
  append exactly the next revision.
- Deployment finalization commits the immutable deployment, artifact evidence,
  optional environment revision, idempotency result, audit event, and
  credential-free verification outbox message together.
- Client registration upserts the stable physical device and client identities,
  then appends an observation in one transaction.
- Agent reporting verifies the client, agent, deployment, and organization
  relationship before appending an observation.
- Membership suspension or removal revokes active sessions/tokens as applicable
  and updates the owned client-installation lifecycle without deleting history.

## Approval and activation record

Maintainer approval covered replacing the pre-public project/release schema
rather than maintaining compatibility aliases, adding physical-device
management and the four installation/observation subjects, and resetting
disposable Platform data.
The approval did not authorize publication, production rollout, private Cloud
schema changes, groups, assignments, or additional views.

The Drizzle migration parser, clean PostgreSQL application, API transactions, worker
outbox, registry digest verification, client/agent observation flow, backup,
restore, and dashboard are verified by the repository test and self-host
verification commands. Drizzle owns the applied-migration ledger under the
`radius_migrations` schema while product tables remain in `radius_platform`.
