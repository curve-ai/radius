# Radius Platform relational logical model

**Status:** Approved and implemented baseline

**Date:** 2026-08-27

## Domain boundary

Radius Platform is the company control plane for distributing agents to Radius
desktop clients. One company is one organization. An organization has users,
many agents, and managed devices. A local desktop project is a work folder and
is not a Platform agent.

```text
Organization
├── memberships -> accounts -> external identities
├── developer tokens -> atomic scopes
├── agents
│   ├── environments -> append-only environment revisions
│   └── immutable deployments -> artifacts
└── physical devices
    └── client installations -> client observations
        └── agent installations -> agent observations
```

## Core subjects

- `accounts` are stable internal people. `account_identities` bind an account to
  an external OIDC `(issuer, subject)`. Email is profile metadata and never the
  merge key.
- `organizations` are companies. `organization_memberships` connect users with
  one role and lifecycle state. There are no organization groups in v1.
- `developer_tokens` belong to a membership. Their scopes are separate atomic
  rows. Optional `developer_token_agents` restrict a token to selected agents.
- `agents` contain stable organization-owned metadata and an `agent_...` public
  reference.
- `agent_deployments` are immutable, digest-addressed versions of one agent.
  Their upload intent and artifact evidence are separate subjects.
- `agent_environments` are named desired-state tracks such as development,
  staging, and production. An append-only `agent_environment_revision` selects
  a verified deployment. Promotion and rollback select an existing deployment;
  they never rebuild it.
- `physical_devices` are company-managed machines with bounded management
  metadata and a non-secret stable fingerprint.
- `client_installations` are Radius desktop installations on a physical device.
  `client_installation_observations` append desktop/runtime version and health
  evidence.
- `agent_installations` connect one agent to one client.
  `agent_installation_observations` append the deployment and installation
  result actually observed on that client.

## Cardinality and ownership

- One account can have many external identities and organization memberships.
- One company has many memberships, agents, and physical devices.
- One agent has many environments and immutable deployments.
- One environment has many ordered revisions and one derived current revision.
- One physical device can have multiple client installations over time.
- One client installation belongs to one physical device and one membership.
- One client has at most one stable installation identity per agent.
- A client and agent can have many append-only observations over time.

Every device, membership, client, agent, deployment, and observation connected
by a workflow must resolve to the same organization. An agent observation's
deployment must belong to the installation's agent.

## Reliability and audit records

`idempotency_records` make repeated writes safe. `job_outbox_messages` commit
background work with authoritative product state and are later published to
the queue using a deterministic ID. `audit_events` capture the actor, bounded
action code, explicit supported subjects, result, and safe metadata.

Redis and logs are not sources of truth. Job payloads contain identifiers,
digests, and versioned instructions, never credentials.

## Credential custody

- Human passwords, passkeys, MFA, and recovery remain at the external OIDC
  provider.
- PostgreSQL stores random session and developer-token values only as hashes and
  non-secret prefixes.
- Registry credentials are short-lived responses or deployment secrets, not
  product rows.
- Agent and connector credentials remain host-owned in the operating-system
  credential vault; local rows contain opaque references where needed.
- Device private keys and raw hardware identifiers never enter Platform rows.

## Version reconciliation

An environment selects the desired immutable deployment. A deployment declares
its minimum desktop version and runtime protocol. Each client reports its actual
desktop/runtime versions and installed deployment.

A compatible client installs the desired version. An incompatible old client
keeps its last ready compatible version and appends a
`blocked_incompatible` observation. After a desktop update, reconciliation may
retry the same desired deployment. This requires no per-user assignment and no
mutation of historical deployments.

## Deliberately absent

- organization groups and per-user/group agent assignments;
- desired/current or drift tables and installation views;
- passwords or a self-hosted password database;
- billing, entitlements, usage metering, support, and Cloud fleet subjects;
- raw MDM payloads, network/location history, or broad device telemetry; and
- Kubernetes-specific state.

Those subjects require a real workflow and separate schema approval.
