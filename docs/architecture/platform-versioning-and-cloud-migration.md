# Platform versioning and Cloud migration

**Status:** Approved architecture; core compatibility and observation fields implemented
**Date:** 2026-08-27

## Plain-language vocabulary

- **Reliability records** are internal bookkeeping: idempotency prevents a
  retried request from performing the same write twice; the transactional
  outbox prevents background work from being lost; audit events record who did
  what. They are not user-managed product objects.
- **Environments** are the previously described delivery tracks. Development,
  staging, and production select which immutable agent deployment is desired.
- **Capabilities** are typed things an agent deployment asks Radius to provide,
  such as filesystem read/write, shell execution, browser control, a connector
  operation, or an allowed network destination. They are not organization roles
  and they contain no credential values.

## Compatibility across desktop and agent versions

An agent deployment declares its manifest version, runtime protocol, minimum
desktop version, and capability requirements. A client-installation observation
reports its desktop and runtime versions. Radius code maps a signed desktop
version to the public contracts it supports.

```text
organization production environment → desired agent deployment v3
                                      ├── compatible desktop → v3 ready
                                      └── old desktop → retain v2 + report blocked
```

Reconciliation rules:

1. Never rebuild or rewrite a deployment for an old client.
2. Never silently drop an unknown permission or capability requirement.
3. Keep the last ready compatible deployment until the desktop updates.
4. Report the blocked state through an append-only installation observation.
5. Retry desired state after a desktop update observation arrives.
6. Keep API and sync envelopes versioned and support an explicit bounded
   compatibility window; otherwise return `upgrade_required`.

Session/project sync remains independent of deployment reconciliation. Sync
records carry their own schema version and revision. Ordinary additive fields
may use contract-defined defaults; unknown security or authorization fields
fail closed.

The desktop now has an optional initial reporter for self-host and managed-stack
integration. When `RADIUS_PLATFORM_API_URL`,
`RADIUS_PLATFORM_ACCESS_TOKEN`, and `RADIUS_PLATFORM_ORGANIZATION` are all
configured, startup registers the stable local client instance, derives a
non-secret physical-device fingerprint from its existing OS-protected public
device key, and appends a desktop/runtime version observation. The access token
is neither logged nor written to Platform product tables. This environment
credential is an enrollment and development path, not the final customer sign-in
experience. A managed installation should supply the same reporting call with a
short-lived OIDC-derived credential.

## Credential storage

Different credentials require different custody:

- Human passwords are not stored by Radius. An external OIDC provider handles
  password, passkey, MFA, and recovery.
- Radius browser sessions and developer tokens are high-entropy random values;
  PostgreSQL stores only their SHA-256 hashes and public prefixes.
- Registry and deployment secrets live in deployment secret files or a secret
  manager, not product rows or job payloads.
- Agent, model-provider, and connector credentials remain in the operating
  system credential vault by default; local tables store opaque references.
- Provider refresh tokens are not required for Platform browser login and
  should not be copied during migration.

SHA-256 is appropriate for random 256-bit session/API tokens because they are
not guessable human passwords. A password would require a password-specific
KDF such as Argon2id and is deliberately excluded.

## Passwordless company authentication

Use OIDC Authorization Code with PKCE for customer users. The durable external
identity is `(issuer, subject)`, never email. The Platform's internal
`account_id` remains stable and organization memberships refer to that account.

Better Auth is not required in each customer Platform stack. It may remain a
separate private authentication system for Curve operators, but operator and
customer sessions must not share cookies or audiences.

## Self-hosted to Curve Cloud migration

The source Platform exports and the managed target imports:

- stable account IDs;
- verified `(issuer, subject)` identity links;
- organization and membership IDs, roles, and lifecycle;
- agents, deployments, environments, and revisions;
- physical/client/agent installation identities and safe observations;
- audit and idempotency evidence required by the migration boundary; and
- OCI registry content with digest verification.

Do not migrate browser sessions, OTP challenges, OAuth authorization attempts,
provider access/refresh tokens, or plaintext developer tokens.

After import:

1. Users sign in again through the same OIDC provider.
2. The verified `(issuer, subject)` resolves to the preserved `account_id` and
   membership, so their organization access returns immediately.
3. Desktop clients switch to the managed Platform origin, authenticate again,
   and reuse their stable local client-instance ID.
4. Clients report fresh desktop and agent installation observations.
5. Developer automation creates replacement scoped tokens on the managed
   target and revokes source tokens.

If the OIDC provider uses client-specific or pairwise subjects, reuse the same
provider registration where safe or import an administrator-reviewed identity
mapping. Never merge users by email alone.

## Legacy Better Auth migration

The current private Cloud Better Auth configuration already disables password
authentication and uses hashed email OTP plus optional Google OAuth. For users
with a verified external account, map Better Auth's external issuer/account ID
to Platform `(issuer, subject)` while preserving the Platform account and
membership IDs.

OTP-only users have no durable external OIDC subject. Before cutover, require
them to authenticate to the old service and explicitly link Google or the
company OIDC provider, or let an organization owner approve a one-time verified
identity mapping. Do not silently bind a new OAuth identity from an email match.

All Better Auth sessions are invalidated at cutover. This is intentional: users
sign in again and receive host-local Platform sessions. Once every customer
identity is mapped, Better Auth customer records can be archived; no password
database is moved.
