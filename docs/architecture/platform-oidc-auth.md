# Platform OIDC browser authentication

**Status:** API protocol, provisioning, hashed sessions, dashboard session
consumption, and membership-authorized reads implemented

**Date:** 2026-08-26

## Boundary

Radius Platform supports provider-neutral OpenID Connect Authorization Code
authentication with S256 PKCE. Self-host operators configure an issuer and
client; Curve Cloud may provide the same public configuration through managed
secrets. No Curve account or private package is required.

The implementation uses the already-approved `accounts`,
`account_identities`, `platform_sessions`, organizations, memberships, and
audit tables. It adds no schema or provider-specific identity columns.

## Flow

1. `GET /api/platform/v1/auth/oidc/login` discovers the issuer, creates random
   state, nonce, and PKCE verifier values, and redirects to authorization.
2. A ten-minute HttpOnly, SameSite=Lax transaction cookie carries a signed
   versioned transaction. Its HMAC key is deployment configuration, at least 32
   random bytes. The cookie is host-only and Secure outside explicit loopback
   development.
3. The callback verifies cookie signature/expiry, state, nonce, PKCE, issuer,
   audience, authorization response, token response, JWKS signature, and ID
   token claims through `openid-client` 6.8.7.
4. An existing `(issuer, subject)` identity is reused. A new identity requires
   a verified email matching an exact-email or domain allowlist.
5. Provisioning either links an explicitly configured bootstrap account or
   creates an account, then joins exactly one configured organization and role.
6. Radius returns a random `radius_sess_...` cookie and stores only its 32-byte
   SHA-256 hash, public prefix, identity reference, lifecycle timestamps, and an
   append-only audit event.
7. Session inspection returns all active organization memberships. Logout and
   expiry revoke access; no provider access or refresh token is stored.

Unknown identities and incomplete configurations fail closed. Host routing is
never authorization, email does not become an account key, and an unverified
email can never provision membership.

## Configuration

Required when OIDC is enabled:

```text
RADIUS_OIDC_ISSUER
RADIUS_OIDC_CLIENT_ID
RADIUS_OIDC_REDIRECT_URI
RADIUS_OIDC_TRANSACTION_SECRET
RADIUS_OIDC_ORGANIZATION
RADIUS_PLATFORM_APPLICATION_URL
```

At least one of these provisioning allowlists is required:

```text
RADIUS_OIDC_ALLOWED_EMAILS
RADIUS_OIDC_ALLOWED_EMAIL_DOMAINS
```

Optional configuration:

```text
RADIUS_OIDC_CLIENT_SECRET
RADIUS_OIDC_SCOPES
RADIUS_OIDC_AUTO_JOIN_ROLE
RADIUS_OIDC_BOOTSTRAP_ACCOUNT_ID
RADIUS_OIDC_SESSION_TTL_SECONDS
RADIUS_OIDC_TRANSACTION_COOKIE
RADIUS_PLATFORM_SESSION_COOKIE
RADIUS_OIDC_ALLOW_INSECURE_LOOPBACK
```

Insecure discovery/token endpoints and non-Secure cookies are accepted only
for an explicit loopback issuer and callback.

## Verification

- Unit checks cover URL/scope/secret/cookie configuration, exact cookie names,
  signature tampering, expiry, return-path validation, and fail-closed
  provisioning policy.
- A local mock provider completed discovery, HTTP Basic client authentication,
  authorization-code exchange, S256 PKCE, state, nonce, signed RS256 ID-token,
  issuer, audience, and claims validation. A wrong state was rejected.
- A disposable PostgreSQL proof provisioned an allowlisted viewer, stored only
  the session hash, authenticated it, revoked it, rejected reuse, and removed
  temporary account/session rows while preserving audit history.

The open dashboard now requires the host-only session in browser-session mode,
uses session identity to select the visible organization, renders explicit
login/error/logout states, and revokes sessions on logout. Server Components
forward the cookie directly to Platform data routes. Each organization/agent
read joins the session account to active memberships in PostgreSQL; unjoined
resources return non-enumerating 404 responses. No dashboard service token is
required. Browser-session writes currently fail closed with
`BROWSER_SESSION_WRITE_FORBIDDEN` unless the operation has an explicit role
rule. Organization administration, developer-token management, and deployment
promotion/rollback now use:

| Role | Read | Deploy/promote/rollback | Manage developer tokens | Manage members |
| --- | --- | --- | --- | --- |
| owner | yes | yes | yes | yes |
| admin | yes | yes | yes | no |
| developer | yes | yes | no | no |
| viewer | yes | no | no | no |

Browser actors are stored as membership IDs in deployment and audit evidence;
developer-token actors remain token IDs. Idempotency fingerprints include the
actor type and ID. Token secrets remain one-time and granted scopes cannot
exceed the role scope set.

The open dashboard exposes these rules directly. Settings gives owners and
admins a scoped token form, one-time secret disclosure, token inventory, and
revocation. Agent deployment rows give owners, admins, and developers contextual
Promote or Roll back actions. Each Server Action validates the selected
organization, reloads the current deployment revision, and then calls the same
public Platform API used by the CLI. Viewer pages contain no mutation controls;
forged writes still fail at the API boundary.

Owners can also list and mutate organization memberships in Settings or with
`radius members`. The current actor cannot mutate itself, and the final active
owner cannot be demoted, suspended, or removed. Role changes revoke the target
membership's developer tokens so old scopes cannot survive a downgrade.
Suspension revokes browser sessions while preserving blocked tokens for a later
restore; removal revokes both sessions and tokens. OIDC provisioning now reads
the existing membership regardless of lifecycle and rejects suspended or
removed access without attempting a duplicate insert. An owner restore permits
the next allowlisted sign-in to create a new session on the same account and
membership.

Accounts with multiple active memberships receive the existing Radix
organization selector. It stores only a server-validated slug cookie, returns
to Overview on change, and clears selection on logout.

Deployment prepare and finalize now require an explicit organization in the
version-1 request. Browser owner/admin/developer sessions and scoped developer
tokens share the same membership authorization, actor, idempotency, audit,
registry-verification, immutable deployment, optional environment revision, and outbox
transactions. Viewer writes fail closed. The CLI infers an organization only
when its credential has exactly one membership; otherwise `--organization` is
required. No ambiguous first-membership fallback exists.
