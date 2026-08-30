# Capability authorization logical model

**Status:** Approved; implementation in progress

**Date:** 2026-08-22

**Implementation:** Connector capability contracts, operations, providers,
bindings, profile projections, the MCP client adapter, and required/optional
agent availability resolution are implemented. The first macOS ACP terminal
and text-file adapters now enforce release requests, project roots, exact
outside-path approvals, and invocation history without a schema change. Policy
revisions, run snapshots, durable external-path grants, and the guest MCP bridge
remain in progress.

## Mission

Radius needs a durable, local-first authorization model that can determine which
host capabilities a particular agent run may use, communicate the usable subset
to the vendor-owned agent, enforce every invocation in the host tool broker, and
retain enough evidence to explain the decision later.

The model must preserve the existing boundary: an agent release requests
capabilities, policy may grant or restrict them, and only the trusted host can
exercise them. A capability descriptor sent to an agent is not bearer authority.

## Objectives

- Record the capabilities requested by each immutable signed agent release.
- Record whether an agent release supports the Radius MCP bridge through signed
  manifest configuration or a bounded staging-time runtime probe.
- Record which built-in and configured tool providers can implement those
  capabilities on one client instance.
- Represent system, organization, and local-user policy without reducing access
  to one coarse `enabled` flag.
- Scope policy to a client, agent installation, project, agent/project pair, or
  session and to typed local resources.
- Derive one effective `allow`, `ask`, `deny`, or `unavailable` result for each
  requested provider/tool binding.
- Snapshot the capability descriptors offered to an agent run without storing
  reusable bearer tokens.
- Re-evaluate every tool invocation so policy changes and revocations take effect
  after a run has started.
- Keep one-time approval decisions separate from durable policy changes.
- Keep local paths, connector credentials, and ephemeral capability handles out
  of public sync payloads.

## Non-goals

- Vendor-domain authorization for tenants, accounts, datasets, workflows,
  entitlements, or licensed skills. The vendor-owned loop retains that layer.
- Implementing the supervised runtime, tool broker, MCP discovery, or policy UI.
- Selecting SQL types, indexes, query plans, or migration sequencing.
- Defining an operated organization-policy service in Radius.
- Syncing local authorization state in protocol v1.
- Making the renderer, agent container, or Cloud database an authorization
  authority.

## Existing facts this model preserves

- The signed agent-release manifest requests capabilities but does not grant
  them.
- `project_roots` already owns the device-local canonical source-folder paths
  for one project. This model references those relationships and does not copy
  their paths.
- Linking a project root establishes one resource boundary and user consent for
  that root. An agent must still request the relevant operation and pass policy
  evaluation. Once allowed, operations contained by an authorized root do not
  require
  per-file approval.
- `tool_calls`, `approval_requests`, and `approval_decisions` remain immutable
  invocation history. They are not the source of durable grants.
- MCP is a provider behind the host tool broker, not a parallel permission
  system.
- Permission mode and approval policy remain separate. A broad filesystem or
  sandbox mode can still require approval for a particular operation.

## Terms

**Capability contract**
: A versioned host-recognized namespace such as `workspace.files`, `shell`, or a
  namespaced MCP server contract.

**Capability operation**
: One callable operation within a contract, such as `read`, `write`, `execute`,
  or `get_issue`. The pair `(capability key, operation name)` matches the current
  tool-event vocabulary.

**Agent-release request**
: One operation requested by one immutable signed agent release. A request is a
prerequisite, never a grant.

**Agent tool interface**
: A versioned host integration surface an agent can consume, such as the
  Radius-managed MCP bridge. Support may be declared in the signed manifest or
  reported by a bounded probe of the exact signed release during staging.

**Tool provider**
: A device-local configured executor, such as Radius's built-in filesystem or
  shell adapter, or one configured MCP server connection.

**Tool binding**
: The mapping from one tool provider's callable tool to one capability operation
  and its exact versioned schemas.

**Policy ceiling**
: A mandatory maximum imposed by the host or an organization. A more specific
  preference cannot loosen it.

**Policy preference**
: A local-user choice such as a persistent project grant or a session access
  profile. Specific preferences may replace broader preferences, but no
  preference can override a denial or a policy ceiling.

**Run authorization snapshot**
: Immutable evidence of the descriptors offered to one run and the policy
  revisions used to derive them. It does not authorize execution by itself.

**Invocation approval**
: A decision about the exact immutable input of one tool call. It has no effect
  on later calls unless the user separately creates a durable policy revision.

## Logical subjects

Names below are candidate logical names, not approved physical table names.

### Agent package subjects

| Subject | Primary identity | Required characteristics | Alternate identity and rules |
| --- | --- | --- | --- |
| `agent_identities` | Opaque agent UUID | Stable publisher reference, stable vendor agent key, display name | Publisher plus vendor agent key is unique. No publisher secret is stored. |
| `agent_releases` | Opaque release UUID | Agent identity, semantic/display version, immutable image digest, manifest digest, protocol version, publication time | Image digest is globally unique; agent plus version is unique. A release is immutable after verification. |
| `agent_release_revocations` | Release UUID | Revoking issuer, revocation time, stable reason code, optional evidence reference | At most one effective revocation per release. Revocation is append-only and does not edit the release. |
| `agent_installations` | Opaque installation UUID | Client instance, agent identity, selected release, lifecycle state, installation/update times | At most one active installation of one agent identity on one client. Disable or uninstall rather than deleting referenced history. |
| `agent_release_capability_requests` | Release plus capability-operation key | Required/optional requirement, manifest position if presentation order matters | One request per release and operation. Capability lists are rows, never a JSON or comma-delimited list. |
| `agent_release_tool_interface_declarations` | Release plus tool-interface key | Interface kind, required/optional requirement, declaration source (`manifest` or `runtime_discovery`) | One declaration per release and interface. Absence means unsupported. |
| `agent_release_tool_interface_versions` | Declaration plus protocol version | One accepted protocol version | Declaration plus protocol version is unique. Versions are rows, never a JSON list. |
| `agent_installation_interface_probe_reports` | Opaque report UUID | Agent installation, exact release, interface kind and negotiated version, probe outcome, creation time | A successful report belongs to the selected release and current installation. Later probes supersede rather than edit evidence. |
| `agent_installation_probe_capability_requests` | Probe report plus capability operation | Required/optional requirement reported by the runtime | One request per report and operation. Reports may request but never grant authority. |

Capability-specific manifest data that Radius must authorize is modeled as a
typed child subject. For example, declared network destinations are individual
`agent_release_network_destination_requests` rows. Extension JSON may be kept
only when it has a versioned validator and is not trusted as an authorization
selector until the host adapter validates it.

For a `manifest` declaration, the release capability requests are the
provider's configured requirements. For `runtime_discovery`, the release
declaration permits a bounded staging probe and the successful installation
probe report supplies the device-local request set. Runtime discovery cannot
introduce a capability contract or operation unknown to the host.

### Capability and provider subjects

| Subject | Primary identity | Required characteristics | Alternate identity and rules |
| --- | --- | --- | --- |
| `capability_contracts` | Opaque contract UUID | Stable capability key, contract version, provider kind, description | Capability key plus contract version is unique. Contracts are immutable after use. |
| `capability_operations` | Opaque operation UUID | Contract, operation name, input/output/progress schema identifiers and versions, risk class, whether interactive approval is permitted | Contract plus operation name is unique. A schema change creates a new contract/operation version. |
| `tool_providers` | Opaque provider UUID | Client instance, provider kind, stable local provider key, label, configured/disabled times | Client plus local provider key is unique. Health is observed runtime state, not a durable grant. |
| `tool_bindings` | Opaque binding UUID | Provider, capability operation, provider-native tool name, discovered schema hash, enabled/disabled times | Provider plus native tool name plus discovered schema hash is unique. A changed MCP schema creates a new binding and does not inherit grants silently. |
| `network_destinations` | Opaque destination UUID | Canonical hostname, optional port, transport/TLS requirements | Canonical destination tuple is unique. Each destination is one row; allowlists are relationships. |

Built-in operations and discovered MCP tools share the same authorization path.
The built-in registry may originate in versioned Radius code, while installed
rows provide referential integrity for requests, policies, bindings, and run
evidence. A configured MCP provider stores only an opaque credential-store
reference. Credential bytes remain in the operating-system credential store.

### Policy subjects

| Subject | Primary identity | Required characteristics | Alternate identity and rules |
| --- | --- | --- | --- |
| `policy_issuers` | Opaque issuer UUID | Issuer kind (`system`, `organization`, `local_user`), stable external/local key, display label | Kind plus stable key is unique. The row identifies an authority; it contains no signing or connector secret. |
| `authorization_policies` | Opaque policy UUID | Issuer, stable name, enforcement kind (`ceiling` or `preference`) | Issuer plus stable name is unique. System and organization policies must be ceilings. |
| `authorization_policy_revisions` | Opaque revision UUID | Policy, positive revision number, optional superseded revision, creation time, optional validity interval, content hash | Policy plus revision number is unique. A revision is immutable after assignment and is superseded, not edited. |
| `authorization_policy_revision_revocations` | Policy revision UUID | Revoking issuer, revocation time, stable reason code, optional evidence reference | At most one effective revocation per revision. Revocation is append-only and does not edit the revision. |
| `authorization_rules` | Opaque rule UUID | Policy revision, capability operation, effect (`allow`, `ask`, `deny`), explicit resource mode (`all` or `selected`) | One revision may contain multiple rules only when their typed resource scopes differ. `null` never means all resources. |

An operation absent from a policy revision means that policy has no opinion. It
does not mean allow. Unknown contracts, unknown operations, and invalid schemas
fail closed.

Policy revisions are assigned through separate, typed relationship subjects:

- `client_policy_assignments`
- `agent_installation_policy_assignments`
- `project_policy_assignments`
- `agent_project_policy_assignments`
- `session_policy_assignments`

Each assignment identifies exactly one policy revision, its exact context, the
assignment time, the assigning actor, and write-once revocation evidence when
the assignment is ended. Separate relationship subjects preserve foreign keys
and make specificity explicit; a generic `(scope_type, scope_id)` pair is
deliberately rejected.

Rules select resources through typed relationships rather than a security-
critical JSON selector:

- `authorization_rule_project_roots` references the opaque `project_roots.id`
  without copying `root_path`.
- `authorization_rule_tool_providers` selects a configured provider/account.
- `authorization_rule_network_destinations` selects individual canonical
  destinations.

Additional resource kinds require a new typed relationship and validator. They
must not be smuggled into a generic string pattern. Entries within one resource
dimension are alternatives; when a rule uses multiple dimensions, every
populated dimension must match.

### Run authorization subjects

| Subject | Primary identity | Required characteristics | Alternate identity and rules |
| --- | --- | --- | --- |
| `run_authorization_snapshots` | Opaque snapshot UUID | Agent run, positive snapshot revision, optional superseded snapshot, installation, exact agent release, creation time, canonical resolution hash | Run plus snapshot revision is unique. Revision 1 is initial; a refresh creates the next immutable revision rather than editing the old one. |
| `run_authorization_policy_revisions` | Snapshot plus policy revision | Contribution kind and assignment specificity | Records every policy revision used by the resolver. |
| `run_capability_authorizations` | Opaque authorization UUID | Snapshot, exact manifest or probe request, exact tool binding, effect (`allow` or `ask`), capability/resource descriptor evidence | Snapshot plus request plus binding is unique. Only `allow` and `ask` entries are advertised as callable. |
| `run_capability_denials` | Snapshot plus manifest or probe request | Result (`deny` or `unavailable`) and stable reason code | One summary denial per requested operation when no binding is callable. Human-readable wording is derived for presentation. |

Typed child relationships record the local resources included by one run
authorization, mirroring the policy resource relationships. The snapshot stores
database identities and canonical evidence, not bearer handles.

At handshake time the broker creates opaque, expiring, run-bound resource
handles. Handles are scoped to the agent installation, run, capability
operation, and selected resource. They are held in runtime memory and are never
stored as durable grants or synced.

### Existing invocation subjects

The existing event subjects remain authoritative for execution history:

- `tool_calls` records the requested capability, operation, schema, and exact
  canonical input.
- `approval_requests` records why that exact call needs review and when the
  request expires.
- `approval_decisions` records the decision and actor for that request.
- `tool_progress_events` and `tool_results` record execution progress and the
  final outcome.

If the approval UI offers “Always allow for this project,” the approval decision
and the durable policy change are two distinct actions in one host-owned
transaction. The policy action creates and assigns a new immutable policy
revision; it never mutates the approval event into a reusable grant.

## Relationships, participation, and deletion

| Parent to child | Participation | Deletion rule |
| --- | --- | --- |
| Agent identity to releases | One identity has zero or more releases; every release has exactly one identity | Restrict once a release is installed or referenced; use revocation. |
| Agent release to revocation | A release has zero or one effective revocation; every revocation identifies exactly one release | Preserve with release history. |
| Agent release to capability requests | One release has zero or more requests; every request has exactly one release and operation | Cascade only while an uninstalled draft is being imported; otherwise restrict through immutable release history. |
| Agent release to tool-interface declarations | One release has zero or more declarations; every declaration belongs to one release | Cascade only while importing an uninstalled draft; otherwise restrict through release history. |
| Tool-interface declaration to accepted versions | One declaration has one or more accepted versions; every version belongs to one declaration | Cascade only while importing an uninstalled draft; otherwise restrict. |
| Client instance to agent installations | One client has zero or more installations; every installation belongs to exactly one client | Restrict while run or policy history exists; use disabled/uninstalled state. |
| Agent installation to interface probe reports | One installation has zero or more immutable reports; every report belongs to one installation and exact release | Preserve reports used for availability or run evidence; supersede rather than edit. |
| Interface probe report to capability requests | One successful report has zero or more requests; every request belongs to one report and operation | Preserve with the report; an unsuccessful report has no requests. |
| Capability contract to operations | One contract has one or more operations; every operation has exactly one contract | Restrict after any manifest, policy, provider, or run reference exists. |
| Tool provider to bindings | One provider has zero or more bindings; every binding has exactly one provider | Restrict after policy, run, or tool history; disable the provider/binding. |
| Policy to revisions | One policy has one or more revisions; every revision has exactly one policy | Restrict assigned revisions; never cascade audit history. |
| Policy revision to revocation | A revision has zero or one effective revocation; every revocation identifies exactly one revision | Preserve with policy history. |
| Policy revision to rules | One revision has one or more rules; every rule has exactly one revision | Draft content may be discarded before assignment; an assigned or snapshotted revision is immutable. |
| Policy revision to typed assignments | One revision may have zero or more assignments; every assignment has one exact context | Revoke the assignment; preserve it while referenced by run evidence. |
| Agent run to authorization snapshots | A locally initiated run must have a current snapshot before its first brokered tool call; imported or mirrored legacy history may lack one; a run may have later refresh snapshots | Cascade only with deliberate removal of the entire run history; normal product deletion follows run/session retention policy. |
| Snapshot to run authorizations/denials | One snapshot has one result for every release request evaluated | Preserve with the snapshot. |
| Tool call to approval request | A call has zero or one approval request | Existing restrictive relationship remains. |
| Approval request to decision | A request has zero or one final decision | Existing restrictive relationship remains. |

## Effective authorization algorithm

Authorization is derived in the host. It is not stored as a mutable `enabled`
property on an agent or capability.

### 1. Eligibility gates

A requested operation is `unavailable` unless all are true:

1. The exact operation appears in the verified active release manifest, or in
   the latest successful bounded probe permitted by that release's signed
   `runtime_discovery` declaration.
2. The client has an enabled tool binding for the exact contract/schema version.
3. Every required local resource exists and is linked on this client.
4. Required credential-store entries exist and are usable.
5. The operation is not revoked by the agent release, publisher, provider, or
   host security policy.

Transient provider health is checked at invocation time. A stale health probe
must not turn an unauthorized operation into an authorized one.

Before an agent is offered for a new task, Radius resolves all `required`
interface declarations and capability requests against the current device. An
agent is not presented in the task picker when a required MCP interface or
operation has no connected, healthy, compatible binding. Missing `optional`
operations do not hide the agent; those operations are omitted from its
handshake and connector-backed product affordances.

An installed-agent management surface may still show an unavailable agent with
the reason and a path to Connectors. Hiding from task selection must not make an
installed package impossible to inspect, update, or delete.

### 2. Ceiling evaluation

All matching system and organization ceiling rules are combined
restrictively:

```text
deny < ask < allow
```

Any matching `deny` produces `deny`. Otherwise, any matching `ask` caps the
result at `ask`. An `allow` ceiling only says that lower layers may decide; it
does not itself grant the operation. No user preference can exceed the ceiling.

Hard host prohibitions are system ceiling rules and cannot be changed by a
package manifest, organization policy, local preference, session mode, or
interactive approval.

### 3. Preference evaluation

Matching local-user preference assignments are ranked by context specificity:

```text
session
agent installation + project
project
agent installation
client default
```

- A matching local-user `deny` at any specificity remains a deny until the user
  explicitly revokes or supersedes it.
- Otherwise, the highest-specificity matching `allow` or `ask` preference wins.
- If equally specific preferences conflict, the more restrictive effect wins.
- If no preference has an opinion, the installed built-in baseline supplies an
  explicit default. Unknown or non-approval-eligible operations default to
  `deny`; an approval-eligible operation may default to `ask`.

Read Only, Auto/Ask, and Full Access are versioned preference profiles compiled
into explicit operation rules. They are not magic booleans or wildcards. A new
operation added in a later Radius or MCP schema version is therefore not
silently granted by an older Full Access profile.

### 4. Final effect

The resolver takes the more restrictive of the ceiling result and preference
result. Only `allow` and `ask` produce a callable descriptor. `deny` and
`unavailable` produce stable machine-readable reason codes so the agent can
choose an alternative without receiving hidden host configuration.

### 5. Invocation-time reauthorization

Before every tool invocation, the broker verifies:

- the opaque handle is authentic, unexpired, and bound to this run and agent;
- capability, operation, provider binding, resource, and canonical input match
  the descriptor and versioned schema;
- the package request, provider, resources, credentials, and policy remain
  active;
- paths remain inside an authorized canonical project root after symlink
  resolution;
- any network destination is explicitly authorized;
- an `ask` operation has an unexpired approval for this exact immutable tool
  call input.

A run snapshot is evidence and discovery input, not a time-of-check bypass. If
policy changed after the snapshot, the current stricter decision wins. The host
may then issue a refreshed snapshot so the agent can adapt.

## Agent handshake

Agent-interface negotiation happens before the runtime receives tools:

1. Radius reads the signed release's interface declaration.
2. A `manifest` declaration provides the configured capability requests.
3. A `runtime_discovery` declaration allows Radius to run the exact staged
   release in a bounded describe mode and record its interface report.
4. Radius intersects the resulting requests with ready local connector
   bindings and policy.
5. Radius registers the virtual MCP bridge only when at least one operation is
   callable.

The runtime then derives a versioned handshake from the current run snapshot. A
representative shape is:

```json
{
  "protocolVersion": 1,
  "authorizationRevision": "sha256:...",
  "toolInterfaces": [
    {
      "kind": "radius.mcp",
      "protocolVersion": "2026-07-28"
    }
  ],
  "capabilities": [
    {
      "key": "workspace.files",
      "operation": "read",
      "contractVersion": 1,
      "inputSchema": { "id": "radius.workspace.files.read", "version": 1 },
      "approval": "allow",
      "resourceHandles": ["run-resource:opaque"]
    },
    {
      "key": "shell",
      "operation": "execute",
      "contractVersion": 1,
      "inputSchema": { "id": "radius.shell.execute", "version": 1 },
      "approval": "ask",
      "resourceHandles": ["run-resource:opaque"]
    },
    {
      "key": "mcp.linear",
      "operation": "get_issue",
      "contractVersion": 3,
      "inputSchema": { "id": "mcp.linear.get_issue", "version": 3 },
      "approval": "allow",
      "resourceHandles": ["run-resource:opaque"]
    }
  ],
  "unavailableRequests": [
    {
      "key": "browser",
      "operation": "navigate",
      "reason": "provider_not_configured"
    }
  ]
}
```

The handshake never contains:

- an absolute host path;
- a connector, model-provider, or vendor credential;
- a container-engine socket or host process primitive;
- an unrestricted browser profile;
- a durable token that can be reused by another run or agent;
- capabilities the active release did not request.

If no compatible connector-backed operation is callable, the handshake omits
`radius.mcp` entirely. Radius does not register an empty MCP bridge or expose
connector terminology to an agent that cannot use it.

## Structural versus application-enforced invariants

### Structural integrity

The eventual relational schema should enforce:

- Stable non-null primary keys for every object and event subject.
- Uniqueness of capability contract versions, operation names within a
  contract, immutable image/manifest digests, policy revision numbers, provider
  native tool/schema bindings, run snapshot revisions and predecessors, and
  one-time approval relationships.
- Foreign keys from requests, bindings, rules, assignments, and run evidence to
  their exact parents.
- Allowed values for effect, issuer kind, enforcement kind, provider kind,
  requirement, lifecycle state, and resource mode.
- Positive schema and policy revision numbers.
- Timestamps in causal order.
- `selected` resource mode never being interpreted as `all` merely because its
  selected-resource rows are temporarily absent.

### Application and transaction integrity

The host-owned storage service and broker must enforce rules that span several
relationships or depend on runtime state:

- An assigned or snapshotted policy revision is immutable.
- A policy revision supersedes only a revision of the same policy.
- System and organization policies use ceiling enforcement.
- A selected-resource rule has at least one compatible typed resource row, and
  no incompatible resource dimension is attached.
- Every configured provider credential reference resolves only in the local
  operating-system credential store.
- Exactly one active release is selected for an enabled installation.
- The selected release belongs to the installation's agent identity.
- An interface probe runs only when the exact release has a signed
  `runtime_discovery` declaration for that interface.
- A successful interface probe reports one protocol version accepted by the
  release declaration and belongs to the installation's selected release.
- A probe capability request references a host-known operation. It cannot add a
  new contract or schema definition.
- A run snapshot evaluates the exact installed release used by the run.
- A refreshed snapshot supersedes only the preceding snapshot of the same run.
- Every provider, project root, and local resource in a run authorization
  belongs to the run's client instance.
- Every release request gets either one or more callable authorizations or one
  summary denial in a completed snapshot.
- Tool calls match an advertised capability contract or receive a structured
  denial; the broker still re-evaluates current policy.
- An approval authorizes only the linked tool call's immutable canonical input.
- Creating a durable preference from an approval is a separate, explicit,
  auditable policy action.
- Policy evaluation fails closed on unknown capability versions, invalid
  schemas, missing resources, expired organization assertions, or contradictory
  active assignments.

## Local, sync, and Cloud boundary

Remain local-only:

- agent installations and selected local releases;
- installation interface probe reports and runtime-discovered requests;
- configured tool providers and credential-store references;
- provider enablement and transient health;
- project-root resource scopes and all absolute paths;
- local-user policy preferences and assignments;
- ephemeral run resource handles.

The existing sync protocol may continue carrying tool calls, approval requests,
approval decisions, progress, and results as session history. This proposal does
not add capability authorization subjects to sync v1.

An optional hosted provider may later deliver signed, expiring organization
policy assertions through a public Radius contract. Radius must cache and
enforce those assertions locally without requiring Cloud for community builds.
Any such public contract or projection requires a separate Radius proposal and
explicit schema/migration approval. Organization identity, distribution,
administration, and operated policy services remain Cloud responsibilities.

## Required validation scenarios

1. A package requests `workspace.files.read`, the project is linked locally,
   and policy allows it: the agent receives only an opaque project-root handle.
2. The same project is mirrored to a second client without a root link: the
   operation resolves `unavailable` and no path crosses sync.
3. A package does not request `shell.execute`: no policy or approval can make it
   callable.
4. A session selects Full Access while organization policy requires approval
   for shell: the final result remains `ask`.
5. A local user has a persistent deny for one MCP tool and selects Full Access:
   the tool remains denied.
6. Two MCP connections expose the same tool: each gets a distinct provider-
   scoped descriptor and opaque resource handle.
7. An MCP input schema changes: a new binding/version is created and the old
   grant does not silently authorize it.
8. An `ask` call changes one argument after approval: the changed call requires
   a new tool call and approval.
9. Policy is revoked after the run handshake but before invocation: the broker
   denies the stale invocation and offers a refreshed snapshot.
10. A symlink changes after approval and escapes the root: containment rejects
    the operation.
11. A credential is removed from the OS store: the operation becomes
    unavailable without exposing the credential reference to the agent.
12. Radius is offline: local package, provider, project, and user policy
    evaluation still works; an expired mandatory organization assertion fails
    closed unless a separately approved public contract defines a bounded cached
    grace period.
13. A release declares required `radius.mcp` support but the current device has
    no connected compatible connector: the agent is absent from task selection
    and remains visible only in agent management with a connector-required
    explanation.
14. A release declares optional `radius.mcp` support with no ready connector:
    the agent remains selectable and receives no MCP bridge or connector tools.
15. A release selects `runtime_discovery`: only a successful bounded probe of
    the exact active release may supply requests, and every request still passes
    operation-level policy and binding resolution.

## Decisions proposed for approval

1. Use separate subjects for package requests, provider bindings, policy,
   runtime resolution evidence, and invocation approvals.
2. Represent capability access as operation-level `allow`, `ask`, `deny`, or
   `unavailable`, never one agent-level enabled-capabilities list.
3. Use immutable, versioned policy revisions plus typed context assignments.
4. Use ceiling policies for system/organization constraints and specificity-
   ranked preference policies for local-user choices.
5. Compile UI modes into explicit versioned operation rules; do not use wildcard
   Full Access that silently includes future operations.
6. Keep security-relevant resource selectors relational and typed; do not use a
   generic `(scope_type, scope_id)` relationship or unvalidated JSON selector.
7. Pass only versioned descriptors and ephemeral opaque handles to agents, and
   reauthorize every invocation.
8. Keep authorization configuration local in v1; make any organization-policy
   delivery or authorization sync a separate public-contract proposal.
9. Let signed agent releases declare MCP support through manifest configuration
   or a bounded staging-time runtime probe, with required/optional presentation
   behavior resolved against the current device.

Approval of this logical direction would authorize a subsequent physical-schema
proposal for review. It would not by itself authorize Drizzle edits, migration
generation or application, backfills, sync projections, or database mutation.
