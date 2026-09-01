# Radius Platform API

This is the first open control-plane API for Cloud and self-hosted Radius. The
Hono application reports the current public contract capabilities and owns
bearer authentication, identity,
deployment preparation/finalization, revision-checked promotion/rollback,
deployment inventory, append-only environment history, client and agent
installation observations, and owner-controlled organization membership routes.
Read collections use
bounded opaque cursor pagination. Persistence and registry operations enter
through injected services so the HTTP product contract does not depend on a
specific database implementation.

## Durable PostgreSQL provider

The container provider is PostgreSQL-backed. Startup applies only approved
migrations through the checksummed ledger and session advisory lock. The
development Compose profile separately opts into fixture authority bootstrap;
normal API startup authenticates any active persisted developer token and does
not create ownership implicitly. Agent/environment creation, upload preparation,
deployments, artifacts, idempotency, environment revisions, installation
observations, audit events, and job outbox messages commit transactionally.
Restarting the API preserves state.

```bash
npx bun@1.3.14 run platform:stack:up
```

Containerized development may additionally set
`RADIUS_PLATFORM_REGISTRY_VERIFY=registry:5000` and the explicit development
flag `RADIUS_PLATFORM_REGISTRY_VERIFY_INSECURE=true`: the CLI receives the
host-reachable registry address while the API verifies the same repository on
the internal Compose network.

In another terminal:

```bash
profile_dir=$(mktemp -d)
RADIUS_CONFIG_HOME="$profile_dir" radius profiles add local \
  --api-url http://127.0.0.1:3110

RADIUS_CONFIG_HOME="$profile_dir" \
RADIUS_ACCESS_TOKEN=dev-token \
radius deploy --environment staging
```

Stop the registry without deleting its volume:

```bash
npx bun@1.3.14 run platform:infra:down
```

The development token, database password, and registry credentials are local
fixtures, not defaults for a shared deployment. The in-memory service remains
only as an isolated API unit-test fixture.

## Operator command

The image also contains `platform-admin.js`. Its `bootstrap-owner` command
migrates an empty database, creates the initial organization owner, grants the
public owner scope set, and prints a generated `radius_pat_...` token once. It
refuses to run after any organization exists. See the
[self-hosting bootstrap guide](../../docs/self-hosting/README.md#initial-owner-bootstrap).

Authenticated owners with `token.admin` can list, create, and revoke their
organization's developer tokens through the public API. New tokens may receive
only scopes held by the caller, secrets are returned once, and current-token
self-revocation is rejected. The CLI workflow is documented under
[developer-token rotation](../../docs/self-hosting/README.md#developer-token-rotation).

## OIDC browser sessions

When the complete `RADIUS_OIDC_*` configuration is present, the API exposes
login, callback, session-inspection, and logout routes. It uses discovery,
Authorization Code + S256 PKCE, signed one-time transaction cookies,
verified-email allowlists, explicit organization/role provisioning, and hashed
host-only sessions. Partial configuration fails startup. See the
[OIDC architecture](../../docs/architecture/platform-oidc-auth.md).

The open dashboard forwards browser sessions directly for membership-checked
reads. Owner/admin sessions can manage developer tokens; owner/admin/developer
sessions can promote and roll back deployments. Viewer writes fail closed.
Deployment prepare/finalize carries explicit organization context and applies the
same role checks to browser memberships and developer-token scopes.

Active owners with `organization.admin` can list memberships, change roles,
suspend or restore access, and mark access removed. The current actor cannot
change itself. Role changes revoke the target's developer tokens, suspension
revokes browser sessions, removal revokes both, and the final active owner
cannot be removed or demoted. Suspended and removed OIDC identities fail closed
until an owner restores the existing membership.
