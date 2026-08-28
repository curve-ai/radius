# Radius Docker stacks

This directory contains two deliberately separate Compose distributions:

- `compose.dev.yml` is the local fixture-backed development stack.
- `compose.self-host.yml` is the strict single-node self-host baseline with
  automatic TLS, browser OIDC, an authenticated registry, no fixture authority,
  non-public data services, and persistent named volumes.
- `compose.self-host.source.yml` replaces the released Radius image references
  with builds from the current checkout.

The self-host baseline routes dashboard and Platform API requests through one
public origin. `/api/platform/*` reaches the API and all other paths reach the
web application. This is required for host-only browser sessions. The OCI
registry uses its own TLS hostname.

See the [self-hosting guide](../../docs/self-hosting/README.md) for installation,
bootstrap, backup, restore, and upgrade procedures.

Run the disposable source-built proof with:

```bash
bun run platform:self-host:verify
```

Validate that every Radius-owned release Dockerfile produces a two-platform OCI
index with the expected labels, healthcheck, and runtime user:

```bash
bun run release:platform-images:verify
```

The verifier uses loopback-only ports and a smoke-only internal certificate
authority. It validates the production Caddyfile, starts an isolated Compose
stack, checks same-origin TLS routing and registry authentication, bootstraps
an owner, deploys through the real CLI, waits for worker verification, destroys
and restores PostgreSQL plus registry state, rechecks the exact OCI digest, and
removes its containers and volumes. It never uses the retained development
stack.

## Development stack

This directory packages the current open Platform into one Docker Compose
profile:

```text
Platform web -> Platform API -> PostgreSQL -> OCI registry
                         |
                         +-> transactional job outbox

Platform jobs -> PostgreSQL outbox -> dedicated Redis -> registry verifier
```

Start it from the Radius repository root:

```bash
npx bun@1.3.14 run platform:stack:up
```

Then open `http://127.0.0.1:3200`. The current development token is
`radius-dev-token` unless `RADIUS_PLATFORM_DEV_TOKEN` is set before startup.
The fixture authority exists only because this development profile defaults
`RADIUS_PLATFORM_BOOTSTRAP_DEV_AUTHORITY=true`. Disable that flag and use the
[initial owner bootstrap](../../docs/self-hosting/README.md#initial-owner-bootstrap)
to exercise a real first-run installation.
The CLI can target the stack without writing a profile:

```bash
RADIUS_API_URL=http://127.0.0.1:3110 \
RADIUS_ACCESS_TOKEN=radius-dev-token \
radius deploy --environment staging
```

Useful commands:

```bash
npx bun@1.3.14 run platform:stack:config
npx bun@1.3.14 run platform:stack:logs
npx bun@1.3.14 run platform:stack:down
```

`platform:stack:down` stops containers without deleting the registry, Redis,
or Postgres volumes.

## What this proves

- Digest-pinned base images and frozen Bun dependency resolution.
- Bundled API and worker runtimes with no development dependency tree.
- Next.js standalone dashboard output on a non-root Node user.
- Non-root API and jobs worker processes.
- Health-ordered startup for Postgres, Redis, API, and dashboard.
- Host-visible versus internal registry endpoint mapping without rewriting
  immutable deployment references.
- Approved checksummed migrations with an advisory lock and clean repeat runs.
- Durable identity, agent, deployment, artifact, environment-revision,
  installation-observation, audit, and idempotency records across API restarts.
- One-time initial-owner bootstrap from the API image, with hashed token
  storage and fail-closed repeat attempts.
- Transactional outbox publication and BullMQ exact-digest verification.
- Real CLI upload/finalization, promotion, rollback, and dashboard reads.
- A separate self-host verifier covering authenticated ingress, bootstrap,
  exact-digest deployment, worker completion, and destructive recovery.

## What this does not prove

This profile is development-only. The API uses a PostgreSQL-backed provider
with an explicit development bearer token and local fixture registry
credentials. Restarting the API preserves organization, agent, deployment,
outbox, and audit state.
The web container explicitly selects `development-token`; production/default
web configuration selects `browser-session` and uses direct membership-checked
Platform reads without a service token.

Do not expose ports publicly or treat the default passwords/token as secrets.
The separate self-host baseline supplies production-shaped authentication, TLS,
registry authentication, secret inputs, and operational procedures. It remains
a single-node baseline, not a high-availability topology. The versioned GHCR
workflow is prepared, but no image set has been published yet.
