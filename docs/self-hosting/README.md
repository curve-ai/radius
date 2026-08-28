# Self-hosting Radius

Radius is being built as a complete self-hostable agent delivery platform, not
as a packaged customer UI that depends on Curve Cloud.

The supported distribution is the
[single-node Docker Compose stack](../../hosting/docker/README.md) for one
operator-managed host. It boots the open dashboard, API, jobs worker, official
PostgreSQL boundary, Valkey-compatible queue, and OCI registry path from public
source. It applies the approved PostgreSQL core migration, persists the
deployment loop, and drains the transactional outbox into BullMQ.

The Docker baseline is appropriate for an operator who accepts one-host
availability. The operator owns DNS, OIDC, secrets, backups, capacity, and
upgrades. Published release images and managed secret-store adapters remain
future release gates. Kubernetes is deliberately not a supported deployment
target.

The baseline has Caddy automatic HTTPS, OIDC with host-only hashed sessions,
bcrypt-authenticated OCI Distribution with deletion disabled, official
PostgreSQL, Valkey AOF persistence, source-built non-root Radius services, and
explicit operator procedures. PostgreSQL remains the durable product/outbox
authority; Valkey is the BullMQ transport.

Self-hosted correctness must never require a Curve account or private package.

## Single-node installation

Point DNS for the platform and registry domains at the host, then allow inbound
TCP 80/443 and UDP 443. Register this exact OIDC callback, substituting the
configured platform domain:

```text
https://agents.example.com/api/platform/v1/auth/oidc/callback
```

Create the local configuration and registry password file:

```bash
cp hosting/docker/.env.self-host.example hosting/docker/.env.self-host
chmod 600 hosting/docker/.env.self-host
htpasswd -B -c /absolute/path/to/radius-registry.htpasswd radius
chmod 600 /absolute/path/to/radius-registry.htpasswd
```

Use the same registry username/password in the htpasswd prompt and env file.
Generate every secret independently with at least 32 random base64url
characters. For a published release, select its exact version, validate the
model, pull the coherent image set, and start it:

```bash
bun run platform:self-host:config
bun run platform:self-host:pull
bun run platform:self-host:up
```

To build the same topology from the current checkout instead:

```bash
bun run platform:self-host:source:config
bun run platform:self-host:source:build
bun run platform:self-host:source:up
```

Before using real domains, run the isolated proof once on the target Docker
host:

```bash
bun run platform:self-host:verify
```

This requires Docker, `htpasswd`, `curl`, `jq`, `shasum`, and Node.js. It builds from
the current checkout, uses only loopback ports, proves TLS routing and registry
authentication, performs a real CLI deployment and worker verification, then
destroys and restores its disposable PostgreSQL database and registry volume.
It cleans up the isolated Compose project on success or failure.

Start the data plane and API, then run the one-time owner bootstrap:

```bash
docker compose --env-file hosting/docker/.env.self-host \
  -f hosting/docker/compose.self-host.yml \
  up -d postgres registry jobs-redis platform-api

docker compose --env-file hosting/docker/.env.self-host \
  -f hosting/docker/compose.self-host.yml \
  run --rm --no-deps platform-api bun platform-admin.js bootstrap-owner \
  --organization acme \
  --organization-name "Acme Engineering" \
  --account-name "Initial Owner"
```

Put the printed Account ID in `RADIUS_OIDC_BOOTSTRAP_ACCOUNT_ID`, keep the token
in a secret manager, and start the stack with `bun run platform:self-host:up`.
The first allowlisted OIDC login links to that owner account. Remove the
bootstrap account ID after linking and recreate `platform-api`. New allowlisted
users receive `RADIUS_OIDC_AUTO_JOIN_ROLE`, which defaults to viewer.

After each allowlisted user's first sign-in, an owner can assign the intended
role from Settings or the CLI:

```bash
radius members list --organization acme
radius members role <membership-id> --role developer --organization acme
radius members suspend <membership-id> --organization acme
radius members restore <membership-id> --organization acme
radius members remove <membership-id> --organization acme
```

The current owner cannot alter itself. Promote a second owner before changing
ownership. Role changes revoke that member's existing developer tokens, and
suspension or removal revokes browser sessions immediately.

The dashboard, API, and CLI share `https://$RADIUS_PLATFORM_DOMAIN`. Caddy
routes `/api/platform/*` to the API so the host-only session cookie remains on
one origin. The registry hostname is separate. PostgreSQL, Valkey, and the
registry's internal HTTP port are not published on the host.

## Initial owner bootstrap

The API image includes a non-server operator command that applies approved
migrations and creates the first organization, owner membership, and developer
token. It is available only while the database contains no organization and
prints the high-entropy token once.

For the development Compose profile, disable fixture seeding, start Postgres,
and run:

```bash
RADIUS_PLATFORM_BOOTSTRAP_DEV_AUTHORITY=false \
  docker compose -f hosting/docker/compose.dev.yml up -d postgres

RADIUS_PLATFORM_BOOTSTRAP_DEV_AUTHORITY=false \
  docker compose -f hosting/docker/compose.dev.yml run --rm --no-deps \
  platform-api bun platform-admin.js bootstrap-owner \
  --organization acme \
  --organization-name "Acme Engineering" \
  --account-name "Initial Owner"
```

Store the printed token in a secret manager. It cannot be recovered from
PostgreSQL: only its SHA-256 hash and non-secret prefix are stored. A second
bootstrap attempt fails closed. For the development dashboard, provide that
token through `RADIUS_PLATFORM_DEV_TOKEN` while keeping
`RADIUS_PLATFORM_BOOTSTRAP_DEV_AUTHORITY=false`.

This solves first ownership for the single-node stack. The Platform implements
OIDC Authorization Code with PKCE, host-only hashed browser sessions, allowlisted
account provisioning, role-aware dashboard access, multi-owner administration,
and developer-token rotation. Provider-specific account recovery and identity
provider incident runbooks remain the operator's responsibility.

## Developer-token rotation

After bootstrap, token lifecycle no longer requires database access. With a
profile and the current owner token configured through `RADIUS_ACCESS_TOKEN`:

```bash
radius tokens list --json

radius tokens create \
  --label "Replacement owner" \
  --scope organization.admin \
  --scope agent.read \
  --scope agent.write \
  --scope deployment.read \
  --scope deployment.write \
  --scope installation.read \
  --scope installation.write \
  --scope token.admin
```

Store the new token shown once, authenticate with it, and revoke the old token:

```bash
RADIUS_ACCESS_TOKEN="$replacement_token" \
  radius tokens revoke "$old_token_id"
```

The API rejects scope escalation, never persists or replays a created secret,
and prevents a token from revoking itself. Creation retries with the same
idempotency key fail with the created token ID but never replay its secret.
Revocation is idempotent and audit-recorded.

Owners and admins can perform the same lifecycle from the open dashboard under
Settings. The created secret is shown once and must be copied before leaving the
page. Owners, admins, and developers can promote or roll back verified
deployments from an agent's deployment inventory. Viewers remain read-only.

## Desktop installation reporting

The desktop can register its stable local client identity and append its
desktop/runtime version at startup. Configure all three variables together in
the desktop process:

```bash
RADIUS_PLATFORM_API_URL=https://agents.example.com
RADIUS_PLATFORM_ACCESS_TOKEN=<token-with-installation.write>
RADIUS_PLATFORM_ORGANIZATION=acme
```

The initial reporter derives a non-secret physical-device fingerprint from the
existing OS-protected public device key. It does not persist or log the access
token. For managed customer enrollment, replace the explicit token provider
with a short-lived OIDC-derived credential while keeping the same public
reporting contract.

## Backup and restore

Create a PostgreSQL custom-format backup while the stack is online:

```bash
docker compose --env-file hosting/docker/.env.self-host \
  -f hosting/docker/compose.self-host.yml \
  exec -T postgres pg_dump -U radius -d radius -Fc > radius-postgres.dump
```

Snapshot the `radius-platform_radius-registry-data` volume at the same recovery
point. Keep database and registry snapshots together because deployments reference
exact registry digests. Caddy state preserves ACME continuity. Valkey can be
restored from AOF or repopulated from PostgreSQL's durable outbox.

For a destructive restore, stop API, jobs, web, ingress, and registry; restore
the registry volume; recreate the empty `radius` database; run `pg_restore`;
then start the complete stack. Rehearse this on a separate host before relying
on the backup.

`bun run platform:self-host:verify` performs this destructive rehearsal against
its own disposable volumes and confirms that the deployment inventory,
installation observations, migration ledger, dashboard login surface, and exact
registry digest survive restoration.

## Upgrade and rollback

Take a paired database/registry backup and change only `RADIUS_VERSION`. For a
published release, pull the image set, inspect `platform:self-host:config`, and
run `platform:self-host:up`. For a source installation, build and run the
matching `platform:self-host:source:*` commands. The API applies checksummed
migrations under an advisory lock before serving. Roll application images back
by restoring the previous coherent version. A release with a
non-backward-compatible database migration requires its documented database
restore procedure; Radius does not pretend migrations can always be reversed.

Inspect health with `docker compose ... ps` and follow service logs with
`bun run platform:self-host:logs`. Next.js telemetry is disabled in the image,
and Radius currently emits no optional product telemetry from this stack.
