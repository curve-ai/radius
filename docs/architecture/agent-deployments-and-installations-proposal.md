# Agent deployments and installations proposal

**Status:** Approved and implemented in the disposable Platform baseline
**Date:** 2026-08-27

## Mission

Track stable agent metadata, immutable versions of each agent, company-managed
physical devices, installed Radius desktop clients, and append-only desktop and
agent installation history.

```text
Organization
├── Memberships ── users
├── Agents ── metadata
│   ├── Agent environments
│   └── Agent deployments ── immutable versions
│       └── Deployment artifacts
└── Physical devices ── managed company machines
    └── Client installations ── Radius desktop installations
        ├── Client installation observations ── desktop version history
        └── Agent installations ── installed agents
            └── Agent installation observations ── agent version history
```

## Vocabulary replacement

| Removed subject        | Current subject                    | Meaning                                                  |
| ---------------------- | ---------------------------------- | -------------------------------------------------------- |
| `projects`             | `agents`                           | Stable agent identity and metadata                       |
| `project_environments` | `agent_environments`               | Development, staging, or production track                |
| `release_uploads`      | `agent_deployment_uploads`         | Temporary upload intent                                  |
| `releases`             | `agent_deployments`                | One immutable version of an agent                        |
| `release_artifacts`    | `agent_deployment_artifacts`       | OCI manifest and evidence for that version               |
| `deployment_revisions` | `agent_environment_revisions`      | Append-only selection of a deployment for an environment |
| none                   | `physical_devices`                 | One managed company machine                              |
| none                   | `client_installations`             | One installed Radius desktop                             |
| none                   | `client_installation_observations` | Append-only desktop-version and health history           |
| none                   | `agent_installations`              | One agent installed on one client                        |
| none                   | `agent_installation_observations`  | Append-only agent-version and state history              |

The public product should say agent rather than project. `project` remains a
desktop workspace concept and no longer names a Platform agent.

## Subjects

### `agents`

Stable metadata for one organization-owned agent.

| Field                    | Rule                                         |
| ------------------------ | -------------------------------------------- |
| `agent_id`               | Application-generated UUID primary key       |
| `organization_id`        | Required organization foreign key            |
| `agent_ref`              | Stable public alternate key                  |
| `slug`                   | Unique within the organization               |
| metadata                 | display name, description, lifecycle state   |
| `default_environment_id` | Optional environment belonging to this agent |
| timestamps               | created and updated                          |

### `agent_deployments`

One immutable, versioned build of an agent. This replaces the term release.

| Field                 | Rule                                                       |
| --------------------- | ---------------------------------------------------------- |
| `agent_deployment_id` | Application-generated UUID primary key                     |
| `agent_id`            | Required agent foreign key                                 |
| `upload_id`           | Unique finalized upload intent                             |
| `version`             | Unique within the agent                                    |
| package identity      | image, source-manifest, and bundle digests                 |
| protocol versions     | positive config and manifest versions                      |
| compatibility         | minimum desktop version and required runtime protocol      |
| verification          | pending, verified, quarantined, or revoked plus timestamps |
| actor and timestamp   | creating membership/token and created time                 |

Deployment content is immutable after verification. Promotion and rollback
select an existing deployment and never rebuild it.

### `agent_environments` and `agent_environment_revisions`

An environment is a named track belonging to one agent. Each append-only
revision selects one verified `agent_deployment_id`, or no deployment for a
revocation. Revision checks prevent lost updates.

This keeps two distinct facts separate:

- an agent deployment is a version that exists; and
- an environment revision selects which version is desired.

### `physical_devices`

One company-managed physical machine.

| Field                    | Rule                                                                     |
| ------------------------ | ------------------------------------------------------------------------ |
| `physical_device_id`     | Application-generated UUID primary key                                   |
| `organization_id`        | Required organization foreign key                                        |
| `assigned_membership_id` | Optional current user membership from the same organization              |
| `device_fingerprint`     | Stable client/MDM-provided alternate key; unique within the organization |
| metadata                 | display name, optional asset tag, platform, architecture                 |
| lifecycle                | active, suspended, retired, or lost                                      |
| timestamps               | created and updated                                                      |

The table is management metadata, not telemetry. Store no raw hardware serial,
private key, IP history, location history, or arbitrary MDM payload.

### `client_installations`

One Radius desktop installation registered by an organization user.

| Field                    | Rule                                         |
| ------------------------ | -------------------------------------------- |
| `client_installation_id` | Application-generated UUID primary key       |
| `physical_device_id`     | Required managed physical device foreign key |
| `membership_id`          | Required organization membership foreign key |
| `client_instance_id`     | Stable local `client_instances.id`; unique   |
| lifecycle                | active, suspended, or removed                |
| timestamps               | installed, created, and updated              |

One physical device may have more than one client installation after a reinstall
or separate operating-system profile. The stable local client ID is projected
into the Platform as an alternate identity; there is no cross-database foreign
key.

### `client_installation_observations`

Append-only evidence reported by one Radius desktop installation.

| Field                                | Rule                                                    |
| ------------------------------------ | ------------------------------------------------------- |
| `client_installation_observation_id` | Application-generated UUID primary key                  |
| client identity                      | required client installation and unique client event ID |
| version evidence                     | desktop app, runtime-helper, and protocol versions      |
| state                                | ready, degraded, update-required, or error              |
| `error_code`                         | Optional bounded safe code                              |
| timestamps                           | client-observed and server-received                     |

The latest observation answers which desktop version is deployed. No duplicate
mutable desktop-version field or current-state view is required.

The server derives the client's supported manifest, runtime protocol, and
capability-contract versions from the reported desktop version and the signed
desktop release metadata. Support lists are not stored as delimited fields.

### `agent_installations`

The stable relationship representing one agent installed on one client.

| Field                    | Rule                                     |
| ------------------------ | ---------------------------------------- |
| `agent_installation_id`  | Application-generated UUID primary key   |
| `client_installation_id` | Required client installation foreign key |
| `agent_id`               | Required agent foreign key               |
| lifecycle                | active or removed                        |
| timestamps               | installed and updated                    |

`(client_installation_id, agent_id)` is unique. Version and health changes are
observations rather than destructive updates to this identity.

### `agent_installation_observations`

Append-only evidence of one agent deployment on one client.

| Field                               | Rule                                                                |
| ----------------------------------- | ------------------------------------------------------------------- |
| `agent_installation_observation_id` | Application-generated UUID primary key                              |
| installation identity               | required agent installation and unique client event ID              |
| `agent_deployment_id`               | Required immutable deployment belonging to the installation's agent |
| state                               | installing, ready, failed, retained, or removed                     |
| `error_code`                        | Optional bounded safe code                                          |
| timestamps                          | client-observed and server-received                                 |

The latest observation answers which agent version is installed. Earlier rows
preserve installation, upgrade, rollback, and failure history without a second
history mechanism.

## Integrity rules

- Device, assigned membership, client membership, agent, and installation must
  belong to the same organization.
- A client installation belongs to exactly one physical device.
- An agent-installation observation's deployment must belong to its agent.
- An environment revision's deployment must belong to its environment's agent.
- Only verified deployments may produce ready installation observations.
- A client installs a deployment only when its desktop version and runtime
  protocol satisfy that deployment's compatibility requirements.
- Removing a membership suspends its client installations and prevents new
  installation updates without deleting evidence.
- Deployment artifacts and environment revisions remain immutable evidence.
- Device, client, and agent installation rows contain no credential or
  private-key material.

## Deliberately absent

- organization groups;
- per-user or group agent assignments;
- desired/current/drift views;
- organization-domain or policy tables; and
- billing or Cloud-operations tables.

No new views are proposed. Existing operational views may be renamed to the
agent vocabulary, but current desktop and agent versions are queried as the
latest observation for one installation.

## Version reconciliation

The production environment selects one desired deployment for the
organization. Each client sends its current desktop version and reports the
agent deployment it actually installed.

1. A compatible client installs the desired deployment.
2. An older incompatible client keeps its last ready compatible deployment.
3. It appends a `blocked_incompatible` agent-installation observation with a
   stable reason code.
4. After the desktop updates, reconciliation retries the organization-desired
   deployment.

The server does not mutate the production environment or create per-user
assignments for old clients. Agent deployments are immutable, so a changed
model, prompt, package, manifest, or capability request creates a new
deployment version. A model-only update can reach old clients when its
compatibility requirements remain unchanged.

API routes, event envelopes, manifests, and capability contracts are separately
versioned. Additive metadata can be ignored only when its contract permits it;
an unknown security-sensitive manifest, capability, or authorization version
fails closed and requires a desktop update.

## Existing model families

### Platform PostgreSQL core

The active Platform models accounts, identities, sessions, organizations,
memberships, developer tokens/scopes, agents/environments, deployment upload,
deployment/artifact data, environment revisions, device/install observations,
idempotency, the transactional outbox, and audit events. The old
project/release Platform names were replaced rather than retained as aliases.

### Embedded Radius desktop storage

The local database already contains:

- `client_instances`;
- `agent_identities`, `agent_releases`, and `agent_installations`;
- agent authentication authorities, accounts, requirements, and bindings;
- connector identities, releases, installations, providers, and tool bindings;
- local projects, sessions, messages, artifacts, files, plans, and runs;
- schedules and scheduled runs; and
- sync connections, cursors, inbox, deliveries, and local changes.

Platform client and agent installation records project these stable local
identities and observations. They do not replace the local authority or copy
local workspace/session data into PostgreSQL.

### Private Cloud models

Cloud separately owns Better Auth records, optional sync projections, connector
catalog/profile state, BullMQ jobs, and private Docker tenant manifests. Those
remain private infrastructure and are not copied into the public Platform
schema.

### Modeled but not approved for this migration

- capability-policy revisions, typed assignments, and run authorization
  snapshots;
- portable agent-authentication profile bindings;
- organization groups and per-user/group agent assignments;
- billing, entitlements, usage metering, support, and incident records; and
- mobile relay or remote-execution state.

## Migration record

Radius was not public and had no Platform users when this replacement was
approved. The disposable v1 migration was replaced in place. No compatibility
migration or legacy API alias was added, and no private Cloud data was
changed.

The public contracts, API, CLI, dashboard, jobs, Compose verifier, and Cloud
operator tenant model must move together to the agent/deployment vocabulary.

## Approval record

Maintainer approval covered:

1. renaming the six Platform subjects above;
2. adding exactly `physical_devices`, `client_installations`,
   `client_installation_observations`, `agent_installations`, and
   `agent_installation_observations`;
3. updating public contracts and product copy from project/release to
   agent/deployment;
4. replacing the disposable approved migration from a clean database; and
5. deleting and recreating only disposable local Platform data during
   verification.

The approval did not authorize publication, production deployment, private
Cloud schema changes, groups, assignments, policy/billing subjects, or new
views.
