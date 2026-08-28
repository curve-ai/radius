# Agent authentication logical model

**Status:** Proposed for design review

**Date:** 2026-08-24

**Implementation:** Not approved. This document authorizes no Drizzle schema,
migration, index, backfill, sync projection, credential migration, or database
mutation.

## Mission

Maintain the non-secret local state Radius needs to connect installed agents to
vendor, model-provider, or router accounts while keeping credential bytes in
the approved credential custodian and keeping vendor identity and entitlement
authority outside Radius.

## Objectives

- Describe every supported authentication authority and flow without storing a
  desktop client secret.
- Record each authentication requirement requested by an immutable agent
  release.
- Represent one device-local authenticated account once, even when several
  agent installations use it.
- Bind an installed agent's exact requirement to one compatible local account.
- Record granted scopes as individual values rather than a list field.
- Derive readiness from current requirements, bindings, account state, expiry,
  custody, and revocation.
- Store only opaque credential references and non-secret metadata in libSQL.
- Support encrypted agent-state compatibility adapters such as fx without
  treating their state files as database credentials.
- Keep portable profile binding intent separate from device-local credential
  readiness.
- Preserve secret-free connection and revocation history without retaining
  authorization codes, PKCE verifiers, access tokens, refresh tokens, or API
  keys.

## Non-goals

- Defining a physical persistence schema.
- Replacing vendor identity, tenant, entitlement, or billing authority.
- Storing credential bytes in libSQL, Cloud sync, session events, logs, or
  analytics.
- Reusing connector `tool_providers` as agent or model-provider accounts.
- Treating Radius sign-in as implicit authorization for a vendor, model, or
  connector account.
- Implementing managed Cloud credential custody in v1.
- Persisting in-progress authorization codes or PKCE verifier material across
  application restarts.

## Existing subjects this model depends on

The model assumes the accepted agent-package subjects proposed by the
capability authorization model:

- `agent_identities`
- `agent_releases`
- `agent_installations`

Those subjects do not yet exist in the physical storage schema. Agent
authentication should not introduce a parallel string-only agent identity just
to ship sooner. The fx alpha can operate without auth tables until the package
installation model is approved and implemented.

`client_instances` already identifies the local Radius installation. The OS
credential vault already encrypts host-owned secret material. Connector
connections remain separate because a configured connector account is a tool
provider with endpoint and schema-binding lifecycle, while an agent/model
account supplies identity or model access to an agent runtime.

## Logical subjects

Names are candidate logical names, not approved table names.

### Authentication authority

| Subject                                | Primary identity        | Required characteristics                                                                                                               | Alternate identity and rules                                                                                                       |
| -------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `authentication_authorities`           | Opaque authority UUID   | Stable authority key, purpose (`vendor_identity`, `model_provider`, `router`), optional canonical issuer, display name                 | Stable authority key is unique. Canonical issuer is unique when present. Email, hostname fragments, and display name are not keys. |
| `authentication_authority_flows`       | Authority plus flow key | Flow kind, public native client ID when applicable, discovery or authorization metadata source, token audience, device-binding support | Authority plus flow key is unique. One row represents one flow; supported flows are never a JSON list.                             |
| `authentication_authority_flow_scopes` | Flow plus scope name    | One allowable/requestable scope name                                                                                                   | Flow plus scope is unique. Scope names are atomic rows.                                                                            |

An authority is a public trust/configuration subject. It contains no client
secret, API key, signing key, cookie, authorization code, or token.

Flow metadata comes from a signed Radius/provider release or a reviewed built-in
adapter. Runtime discovery may confirm endpoint metadata but cannot silently
change issuer, client identity, audience, or custody policy.

### Agent release requirement

| Subject                                        | Primary identity                   | Required characteristics                                                                                              | Alternate identity and rules                                                                                |
| ---------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `agent_release_auth_requirements`              | Agent release plus requirement key | Authority, flow, purpose, required/optional requirement, portability policy, runtime delivery mode, manifest position | Release plus requirement key is unique. A requirement belongs to one immutable release.                     |
| `agent_release_auth_requirement_scopes`        | Requirement plus scope name        | One requested scope, required/optional scope requirement                                                              | Requirement plus scope is unique. Requested scopes are never stored as one string or JSON list.             |
| `agent_release_auth_requirement_custody_kinds` | Requirement plus custody kind      | One permitted credential custodian                                                                                    | Requirement plus custody kind is unique. Permitted custodians are never stored as JSON or a delimited list. |

An agent release requests authentication. It does not select a user's account,
receive a credential, or grant itself new scopes. A changed authority, flow,
audience, delivery mode, required scope, or portability policy is a new signed
release requirement and participates in the release capability-diff review.

### Device-local authenticated account

| Subject                                 | Primary identity        | Required characteristics                                                                                                                                                                                                              | Alternate identity and rules                                                                                                                  |
| --------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `authentication_accounts`               | Opaque account UUID     | Client instance, authority, flow, custody kind, connection state, optional credential reference, optional issuer subject and tenant subject, optional safe label, token expiry metadata, connected/disconnected/revoked/updated times | A provider subject is an alternate identity only within the exact client, authority, and tenant. API-key accounts may have no remote subject. |
| `authentication_account_granted_scopes` | Account plus scope name | One currently granted scope and observation time                                                                                                                                                                                      | Account plus scope is unique. Replacing the scope set occurs transactionally after successful authentication or refresh.                      |
| `authentication_account_observations`   | Opaque observation UUID | Account, event kind, stable result/error code, observed time, optional safe issuer/entitlement revision                                                                                                                               | Append-only secret-free evidence. No token payload, authorization response, verifier, or raw provider error body.                             |

Custody kind is one of:

- `os_vault`: the credential reference resolves only through the Radius host;
- `encrypted_agent_state`: a reviewed compatibility adapter owns the secret in
  an encrypted per-agent volume;
- `managed_exchange`: a compatible hosted provider can issue a short-lived
  token, while no reusable credential is stored locally;
- `none`: identity-only or public access that requires no secret.

Connection state is one of:

- `needs_authentication`
- `connected`
- `expired`
- `revoked`
- `disconnected`
- `error`

Transient provider health is not connection state. A provider outage does not
rewrite a valid linked account as disconnected; invocation checks health and
token availability separately.

### Installed-agent binding

| Subject                         | Primary identity                            | Required characteristics                                                              | Alternate identity and rules                                                                                      |
| ------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `agent_authentication_bindings` | Agent installation plus release requirement | Authentication account, binding time, binding actor, optional unbound time and reason | At most one active account for one installation requirement. One account may serve many compatible installations. |

Absence of a binding means the requirement is unresolved. There is no nullable
account field on a placeholder binding row. Readiness is derived by comparing
the active installation release's requirements with active bindings and account
state.

A binding can reuse an account only when all are true:

1. authority and flow match the release requirement;
2. the account's custody kind is permitted by the requirement;
3. every required scope is currently granted;
4. issuer subject and tenant selection satisfy the user's explicit choice;
5. the account belongs to the installation's client instance;
6. the account is not expired, revoked, disconnected, or invalid;
7. organization policy permits reuse for that agent and tenant.

### Portable profile binding

Portable binding intent belongs in a separate versioned public protocol rather
than the existing session sync stream.

| Subject                                     | Primary identity                     | Required characteristics                                                                                                                                          | Alternate identity and rules                                                                                           |
| ------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `profile_agent_authentication_bindings`     | Opaque profile binding UUID          | Opaque profile subject, agent identity, authority, issuer subject, optional tenant subject and safe label, revision, origin client, created/updated/deleted times | Profile plus agent identity plus authority plus remote subject/tenant is unique while active. Deletion is a tombstone. |
| `device_profile_authentication_projections` | Profile binding plus client instance | Optional local authentication account, applied profile revision, projection state, applied/updated times                                                          | One projection per binding and client. A projection without a local account remains `needs_authentication`.            |

The portable profile binding contains no credential reference, credential bytes,
token expiry, local health, or connected claim. Cloud can communicate linked
intent and revocation, but cannot make an uncredentialed device ready.

## Relationships and participation

| Parent to child                                | Participation                                                                                                               | Deletion rule                                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication authority to flows              | One authority has one or more flows; every flow belongs to exactly one authority                                            | Restrict after any release, account, or history reference. Disable/revoke instead.                                                    |
| Authority flow to allowable scopes             | One flow has zero or more scopes                                                                                            | Restrict after a release requirement or account observation references the scope.                                                     |
| Agent release to auth requirements             | A release has zero or more requirements; every requirement has exactly one release                                          | Cascade only while importing an uninstalled draft; otherwise restrict through immutable release history.                              |
| Release requirement to requested scopes        | A requirement has zero or more requested scopes                                                                             | Preserve with immutable installed release evidence.                                                                                   |
| Release requirement to permitted custody kinds | A requirement has one or more permitted custodians                                                                          | Preserve with immutable installed release evidence.                                                                                   |
| Client instance to authentication accounts     | One client has zero or more accounts; every account belongs to exactly one client                                           | Restrict while bindings or audit history exist; disconnect/revoke instead.                                                            |
| Authority flow to authentication accounts      | One flow has zero or more accounts; every account uses exactly one flow                                                     | Restrict while account history exists.                                                                                                |
| Authentication account to granted scopes       | One account has zero or more currently granted scopes                                                                       | Replace transactionally with the account's verified scope set; delete only with deliberate account purge.                             |
| Authentication account to observations         | One account has zero or more immutable observations                                                                         | Preserve under audit retention; cascade only on deliberate full account-history purge.                                                |
| Agent installation to authentication bindings  | One installation has zero or more bindings; every binding belongs to exactly one installation and exact release requirement | Restrict while run/audit history refers to it; unbind or uninstall instead.                                                           |
| Authentication account to agent bindings       | One account may serve zero or more installation requirements; every binding uses exactly one account                        | Restrict while active bindings exist; disconnect first.                                                                               |
| Profile binding to device projections          | One binding has zero or one projection per registered client                                                                | Profile deletion tombstone removes active projections as devices reconcile; historical observations remain separately retained.       |
| Local account to profile projections           | One local account may satisfy zero or more compatible profile projections                                                   | Nullify only when a device removes the local credential, leaving the projection at `needs_authentication`; never imply global unlink. |

## Structural invariants

- Every key is opaque, stable, non-sensitive, and unrelated to email address or
  token content.
- Every local account, bound installation, and device projection belongs to the
  same client instance.
- Every release requirement references one authority flow that existed in the
  verified signed release context.
- An account's authority matches its flow's authority.
- An active agent binding references the exact auth requirement of the
  installation's active release.
- One installation has at most one active binding per release requirement.
- A credential reference is opaque and device-local. It never appears in
  profile change payloads.
- An `os_vault` account cannot be connected without a usable credential
  reference.
- An `encrypted_agent_state` account cannot be connected without a verified,
  encrypted state installation owned by the bound agent installation.
- A profile binding never determines device readiness.
- Revoked and disconnected accounts cannot satisfy new runs.
- Unknown authorities, flows, custody kinds, delivery modes, and scopes fail
  closed.
- Deleting or updating an agent package never deletes credential material
  shared with another installation.

## Application-enforced rules

These require transaction or runtime context rather than only field and
relationship constraints:

- Validate OIDC issuer, state, nonce, PKCE, audience, redirect, and scopes
  before creating or replacing an account credential.
- Coordinate OS-vault writes and database changes so a connected row never
  claims a missing credential.
- Resolve compatibility between a release requirement and account before
  creating a binding.
- Refresh token and entitlement state with one generation-guarded in-flight
  operation per account.
- Replace granted scopes and account expiry in one transaction after successful
  verification.
- Re-evaluate account state, scopes, release requirement, tenant, policy, and
  revocation before issuing every run credential.
- Deliver only a short-lived audience-restricted token or opaque host handle to
  the exact run.
- Redact all secret values and credential references from observations, errors,
  analytics, logs, and session events.
- When an updated release changes an auth requirement, require explicit
  rebinding unless the host proves exact compatibility and policy permits reuse.

## Derived readiness view

`agent_authentication_readiness` is derived, not stored. For every requirement
of an installation's active release it returns:

- `ready`: compatible active binding and usable account;
- `needs_authentication`: no active binding or account;
- `insufficient_scope`: bound account lacks a required scope;
- `expired`: credential cannot be refreshed without user action;
- `revoked`: provider or profile revocation applies;
- `unavailable`: required authority adapter or credential custodian is absent;
- `error`: stable local verification failure.

An agent is selectable only when every required requirement is `ready`.
Optional requirements may be omitted from the runtime credential set.

## fx alpha boundary

The first fx Codex login does not require this schema.

Radius can derive its alpha state by running the reviewed fx adapter against the
encrypted per-agent profile:

- `fx status --json` for connection status;
- `fx models --json` for the authenticated model catalog;
- the existence and cryptographic availability of the encrypted state volume;
- an explicit local disconnect that invokes fx logout and removes the encrypted
  credential state.

No generic auth row should be invented with `agent_id = 'fx'` before agent
identity, release, and installation subjects exist physically. This keeps the
alpha moving without creating a parallel identity model that later requires a
destructive migration.

## Suggested implementation sequence after approval

1. Implement the approved agent identity, release, and installation subjects.
2. Add authentication authorities and flows from verified built-ins/releases.
3. Add local authentication accounts, granted scopes, and secret-free
   observations.
4. Add installed-agent bindings and the derived readiness query.
5. Add OS-vault coordination and generic OIDC/API-key broker services.
6. Define the separate portable profile-binding protocol.
7. Implement Cloud/self-hosted providers and device projections.
8. Consider managed credential custody only under a separate security and
   operations proposal.

## Decisions proposed for approval

1. Do not create auth tables for the fx alpha; derive status from its encrypted
   device-local adapter.
2. Require agent identity/release/installation subjects before durable generic
   agent-auth bindings.
3. Model authentication authority, local account, release requirement, and
   installed-agent binding as separate subjects.
4. Allow one compatible local account to serve multiple installed agents
   without copying credentials.
5. Store granted scopes as rows and derive readiness rather than storing an
   `is_ready` flag.
6. Keep credential bytes in the approved custodian and only opaque references
   in libSQL.
7. Keep portable non-secret profile bindings in a separate protocol, with
   device readiness remaining local.
8. Keep connector tool providers separate in v1 rather than refactoring the
   newly implemented connector registry during agent-auth alpha work.

Approval of this logical model would authorize a subsequent physical Drizzle
schema and migration proposal for review. It would not authorize schema edits,
migration generation/application, database mutation, or Cloud collection
creation by itself.
