# Connector registry logical model

**Status:** Approved; implementation in progress

**Date:** 2026-08-24

**Implementation:** The public contracts, local Drizzle schema and migration,
transactional connector store, MCP client adapter, tool-broker availability
resolver, desktop IPC, Connectors page, and guarded Cloud profile projection are
implemented. Credential flows, local profile reconciliation, and the agent MCP
bridge remain in progress.

## Mission

Radius needs a device-local connector registry that lets separately packaged
agents use host-managed MCP tools without putting MCP server code, endpoints,
installation commands, or connector credentials in an agent image.

The registry must keep five independently versioned subjects separate:

1. A connector identity published by one publisher.
2. An immutable connector release and its declared capability mappings.
3. One installation of that connector on one Radius client.
4. One configured connection or account exposed as a tool provider.
5. Optional profile-scoped desired state that can project onto many clients.

An agent release requests capability operations. The Radius host resolves those
requests to installed tool bindings and authorizes each invocation. An agent
release may recommend a connector identity, but cannot install, configure,
connect, disconnect, update, or delete it.

## Objectives

- Install, configure, connect, disconnect, update, and delete connectors separately
  from agent packages.
- Support Radius-owned built-in connectors and separately signed connector
  releases through one model.
- Support multiple configured accounts or endpoints for one connector.
- Store only opaque credential references in libSQL. Credential bytes remain in
  the operating-system credential vault.
- Discover MCP tools and bind each exact discovered schema to one versioned
  capability operation.
- Treat schema drift as a new binding that does not inherit authority.
- Let a signed-in user carry portable connector and connection intent across
  their registered computers without making Cloud the local tool executor.
- Resolve agent-provider MCP support against connected, healthy, compatible
  bindings on the current computer before presenting connector-backed agents or
  capabilities.
- Keep credentials and device-local connector state out of sync v1.
- Preserve history after a connector, release, connection, or binding is
  disabled or revoked.

## Non-goals

- Defining the hosted connector directory, publisher-verification service,
  billing, or organization administration.
- Syncing credential bytes, OAuth transaction state, device health, discovered
  bindings, local policy, or run-scoped authorization handles.
- Letting agent images provide executable connector commands or endpoints.
- Running arbitrary local connector code without a separately approved sandbox.
- Adding MCP resources, prompts, sampling, roots, logging, or MCP Apps in v1.
- Selecting indexes or migration sequencing before the logical model is
  approved.

## Logical subjects

Names are candidate logical names. They are not approved table names.

### Capability contracts

| Subject | Primary identity | Required characteristics | Alternate identity and rules |
| --- | --- | --- | --- |
| `capability_contracts` | Opaque contract UUID | Stable key, positive contract version, display name, description | Stable key plus version is unique. A used version is immutable. |
| `capability_operations` | Opaque operation UUID | Contract, stable operation name, input/output schema identifiers and versions, risk class, approval eligibility | Contract plus operation name is unique. A schema change creates a new contract or operation version. |

These are host-recognized semantic operations such as
`presentations.create`. They are independent of a particular MCP server's
native tool name.

### Connector publication

| Subject | Primary identity | Required characteristics | Alternate identity and rules |
| --- | --- | --- | --- |
| `connector_identities` | Opaque connector UUID | Publisher key, publisher-scoped connector key, display name, description | Publisher key plus connector key is unique. Identity is stable across releases. |
| `connector_releases` | Opaque release UUID | Connector identity, release version, immutable manifest digest, minimum host version, publication time | Connector plus release version is unique. Manifest digest is globally unique. Releases are immutable. |
| `connector_release_revocations` | Connector release UUID | Revoking issuer, revocation time, stable reason code, optional evidence reference | At most one effective revocation per release. Revocation is append-only. |
| `connector_release_endpoints` | Opaque endpoint UUID | Connector release, endpoint key, transport kind, canonical endpoint URL, authentication kind | Release plus endpoint key is unique. V1 permits `streamable_http`; loopback development endpoints require an explicit development policy. |
| `connector_release_capability_mappings` | Release plus capability operation | Endpoint, provider-native MCP tool name, expected input schema hash, optional output schema hash | One mapping per release, endpoint, and capability operation. Each field is single-valued. |

A release manifest is validated before these subjects are recorded. Security
decisions use the typed subjects, not unvalidated manifest JSON.

### Profile-scoped desired state

These subjects belong to an authenticated user profile in a compatible hosted
or self-hosted provider. They are portable intent, not executable local state.

| Subject | Primary identity | Required characteristics | Alternate identity and rules |
| --- | --- | --- | --- |
| `profile_connector_installations` | Opaque profile connector UUID | Opaque user-profile identity, connector identity, positive revision, release-selection mode and value, created/updated/deleted times, origin client | User profile plus connector identity is unique while active. A deletion is a tombstone so every device observes it. |
| `profile_connector_connections` | Opaque profile connection UUID | Profile connector installation, positive revision, release endpoint key, optional user-facing account label, optional opaque remote subject, created/updated/deleted times, origin client | A profile connector may have many account connections. A connection identity remains stable across devices until globally deleted. |
| `profile_connector_changes` | Opaque change UUID | User profile, target subject and revision, origin client, payload schema version and hash, creation time | Target plus revision is unique. Changes are immutable and ordered by the provider cursor. |

The Better Auth user identifier is the hosted ownership key. Email address,
account label, endpoint URL, or remote account identifier is never used as a
primary key. A compatible self-hosted provider may use another opaque profile
identity behind the same public contract.

Release selection is either an exact signed release or a signed update channel.
The profile stores the selection rule, while each device still verifies and
stages the resolved release before activation.

The endpoint key refers to an endpoint declared by the selected signed release.
A custom or private endpoint remains device-local by default because its URL may
reveal private infrastructure. Syncing a custom endpoint requires a separate,
explicit profile-scope action and organization policy approval where applicable.

### Device-local installation and configuration

| Subject | Primary identity | Required characteristics | Alternate identity and rules |
| --- | --- | --- | --- |
| `connector_installations` | Opaque installation UUID | Client instance, connector identity, selected release, optional profile connector identity and applied profile revision, lifecycle state, installation/update times | Client plus connector identity is unique. Exactly one selected release belongs to the installation's identity. |
| `tool_providers` | Opaque provider UUID | Client instance, connector installation, release endpoint, optional profile connection identity and applied profile revision, stable local provider key, user-facing label, optional opaque credential reference, enabled/disabled times | Client plus local provider key is unique. One installation may have multiple configured providers for multiple accounts. |
| `tool_bindings` | Opaque binding UUID | Tool provider, capability operation, provider-native tool name, discovered input/output schema hashes, discovered time, enabled/disabled times | Provider plus native tool name plus input schema hash is unique. A changed schema creates a new binding. |

`tool_providers` is the configured executor subject already proposed by the
capability authorization model. A connector installation is not itself a
configured account and cannot be invoked without an enabled provider and exact
binding.

## Relationships and deletion rules

| Relationship | Participation | Deletion rule |
| --- | --- | --- |
| Connector identity to releases | One identity has zero or more releases; every release has exactly one identity | Restrict once installed or referenced; revoke instead of deleting. |
| Connector release to revocation | A release has zero or one effective revocation | Preserve with release history. |
| Connector release to endpoints | A release has one or more endpoints; every endpoint belongs to one release | Cascade only while importing an uninstalled draft; otherwise restrict. |
| Connector release to capability mappings | A release has one or more mappings; every mapping belongs to one release and one operation | Cascade only for an uninstalled draft; otherwise restrict. |
| Client instance to connector installations | A client has zero or more installations; every installation belongs to one client | Restrict while providers or audit history exist; use disconnected or deleted lifecycle state. |
| Connector identity to installations | One identity may be installed once on a client; every installation selects one identity | Restrict while installation history exists. |
| Connector installation to tool providers | One installation has zero or more configured providers; every provider belongs to one installation | Restrict while bindings, policy, run, or tool-call history exists; disable instead. |
| Release endpoint to tool providers | An endpoint may configure zero or more providers; every provider uses one endpoint | Restrict while provider history exists. |
| Tool provider to bindings | One provider has zero or more discovered bindings; every binding belongs to one provider | Restrict while referenced by policy, run evidence, or tool history; disable instead. |
| Capability operation to mappings and bindings | One operation may have many release mappings and installed bindings | Restrict after any manifest, policy, run, or tool history refers to it. |
| User profile to profile connector installations | One user profile has zero or more connector installations; every profile connector belongs to one profile | Global deletion emits a tombstone for delivery, removes the active profile record, and deletes every device projection when devices reconcile. Account deletion removes or irreversibly anonymizes hosted profile state. |
| Profile connector installation to profile connections | One profile connector has zero or more connections; every connection belongs to one profile connector | Global connector deletion cascades to its active profile connections after deletion tombstones are recorded. |
| Profile connector installation to device installations | One profile connector may project to zero or one local installation on each registered client | Global deletion removes every active local projection and local connector credential after vault coordination. Independent audit history remains readable. |
| Profile connection to device tool providers | One profile connection may project to zero or one local provider on each registered client | Global deletion removes every active local provider and credential after vault coordination. A local disconnect changes only the current device projection. |

## Structural invariants

- Every connector release is immutable after verification.
- A selected connector release belongs to the installation's connector
  identity and is not revoked.
- A tool provider, its installation, and its client instance belong to the same
  client.
- A tool provider uses an endpoint declared by its selected connector release.
- A tool binding's native tool name matches a declared mapping for the selected
  release and endpoint.
- A tool binding's discovered schema hashes match the declared hashes before it
  becomes enabled.
- A credential reference is opaque, non-empty, and resolvable only through the
  local operating-system credential vault.
- Disabling an installation makes all of its providers unavailable without
  deleting bindings or invocation history.
- Revoking a release prevents new runs and invocations. Existing audit history
  remains readable.
- Unknown transports, authentication kinds, capability versions, and schemas
  fail closed.
- A profile connector and every profile connection belong to the same opaque
  user profile.
- Profile and connection revisions are positive and monotonic. A mutation with
  a stale expected revision conflicts instead of silently overwriting another
  device.
- A local installation or provider records the exact profile revision it has
  applied. Local readiness never changes the profile revision.
- No profile subject carries a connected, disconnected, enabled, disabled, or
  health state. Those states belong to each device projection.

## Application-enforced rules

- Connector manifests, signatures, compatibility ranges, and canonical hashes
  are verified before one transaction records a release.
- The host allows HTTPS endpoints. Plain HTTP is accepted only for an explicit
  loopback development connection.
- Redirects cannot change the configured host or downgrade transport unless the
  connector contract explicitly permits and validates the destination.
- Enabling a provider requires a successful MCP discovery and exact schema
  match.
- Credential creation, replacement, and deletion are coordinated with the
  operating-system vault so a database row never claims a missing credential.
- Connector updates stage and rediscover before the selected release changes.
- An expanded or changed operation set requires review before new bindings are
  enabled.
- Tool output is untrusted structured content. It cannot create policy,
  credentials, connector configuration, or host commands.
- Every tool invocation is reauthorized against the current release,
  installation, provider, binding, policy, and credential availability.
- A provider's signed agent release declares `radius.mcp` support through
  manifest configuration or permits a bounded staging-time runtime probe. The
  connector registry never infers agent compatibility from an installed
  connector alone.
- A profile connection without a ready local provider does not make MCP
  available on that computer.
- A device reconciles profile intent only after authenticating the user,
  registering the client identity, and verifying that the profile change
  belongs to that user.
- Connector installation and update remain staged local operations. A profile
  change cannot bypass signature, compatibility, capability-diff, health, or
  approval checks.
- An imported profile connection without a usable local credential resolves to
  `needs_authentication`; it is never advertised to agents as callable.
- Disconnecting removes or invalidates the current device credential, disables
  that device's provider and bindings, and leaves the profile plus every other
  device unchanged. Profile reconciliation must not reconnect it silently.
- Deleting a connector or connection is a profile mutation. It records a
  deletion tombstone, removes the active Cloud subject, and removes the active
  local projection and credential from every device as each device reconciles.
  Tombstones remain only as long as required for offline delivery and bounded
  retention. Tool-call and approval audit events remain independently readable.

## Local, sync, and Cloud boundary

Portable profile state:

- connector identity and release-selection rule;
- stable profile connector and connection identities;
- release endpoint key;
- optional user-facing account label and opaque remote subject;
- revisions, origin client, and deletion tombstones.

Remain device-local:

- verified/staged connector releases and installation lifecycle;
- configured tool-provider identities and credential references;
- credential bytes and OAuth transaction state;
- connected/disconnected state and the local disconnect decision;
- discovered schemas and binding enablement;
- transient health and OAuth state;
- local-user policy, approvals, and run-scoped handles.

Sync v1 may continue carrying canonical tool-call, approval, progress, result,
and error events. Connector profile state uses a separate versioned public
contract because its user ownership, revisions, conflicts, tombstones, and
device projections differ from project and session history.

The connector-profile provider authenticates through the same signed-in user
and registered-device boundary as Cloud sync. It stores hosted desired state by
opaque Better Auth user identifier. Radius remains authoritative for local
installation, credential availability, health, binding discovery, policy, and
execution.

V1 profile sync does not move long-lived credentials between devices. A second
computer receives the connector and account intent, then shows
`needs_authentication` until the user authorizes that computer. A future
managed-credential service may keep a refresh credential in a Cloud secret
vault and issue short-lived device-scoped tokens, but that is a separate hosted
security design and public contract.

Cloud may later distribute signed connector identities, releases, revocations,
and organization policy through versioned public Radius contracts. A community
build can install a trusted local manifest or configure a built-in connector
without a Cloud account.

## V1 implementation boundary

The first implementation supports:

- remote MCP connectors over Streamable HTTP;
- host-owned OAuth or bearer credentials;
- tools only;
- exact capability and schema bindings;
- one or more configured accounts per connector;
- optional profile-scoped desired state across registered computers;
- per-device reauthentication for imported profile connections;
- install, configure, connect, disconnect, inspect, and delete lifecycle;
- connection health, timeout, cancellation, and bounded results;
- the existing `allow`, `ask`, `deny`, and `unavailable` authorization effects.

Local stdio connector packages remain unavailable until their executable
artifact, sandbox, update, revocation, filesystem, process, and network model is
separately approved.

## Decisions proposed for approval

1. Use separate subjects for connector identity, release, endpoint,
   installation, configured provider, and discovered binding.
2. Keep capability contracts semantic and independent from native MCP tool
   names.
3. Allow many configured providers per connector installation so multiple
   accounts remain distinct.
4. Store credential references in libSQL and credential bytes only in the
   operating-system vault.
5. Treat connector releases and bindings as immutable evidence; disable or
   revoke rather than deleting referenced history.
6. Sync portable connector and connection intent through a separate
   profile-scoped contract, while keeping execution and security state local.
7. Require per-device authentication in v1 instead of syncing credential bytes.
8. Make disconnect device-local and make delete profile-wide with propagation
   to every registered computer.
9. Implement remote Streamable HTTP connectors first and reject arbitrary
   local stdio packages until a sandbox is approved.
10. Present connector-backed agent capabilities only when the active agent
    release declares or reports compatible MCP support and the current device
    has a ready binding.

Approval of this logical model would authorize a subsequent physical Drizzle
schema and migration proposal. It does not authorize schema edits or database
mutation by itself.
