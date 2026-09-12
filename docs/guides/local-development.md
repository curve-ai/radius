# Run Radius locally

Run the real Platform services and desktop against local PostgreSQL, Redis,
and an OCI registry. Docker Compose is the recommended way to supply those
dependencies. You can instead run them yourself and change their connection
URLs. The application never installs PostgreSQL or starts Docker for you.

All commands below run from the **Radius repository root**, not its parent
workspace. The private Cloud repository is not needed.

## Prerequisites

- Git, Bun 1.3.14 or newer, and Node.js 22.12 or newer.
- Docker with Compose v2, running, or existing PostgreSQL 17, Redis 7/Valkey,
  and an OCI Distribution registry instances you control.
- For the macOS desktop, Apple Silicon and macOS 26 or newer. Xcode 26.2 or
  newer is needed when compiling the microVM runtime for packaged agents.
- `uv` is needed only for Python agents and Python SDK checks.
- Internet access for dependencies and Resend email delivery. For offline
  email testing, use the optional Mailpit profile instead of Resend.

## Install and configure

```sh
git clone https://github.com/curve-ai/radius.git
cd radius
bun install --frozen-lockfile
cp .env.example .env.local
```

The example contains development-only values. Keep `.env.local` untracked and
never use its passwords or tokens for a public installation. Bun loads this
root file for the commands below; it is also passed explicitly to Compose.

The defaults are:

| Component | Local address |
| --- | --- |
| Platform API and desktop connection | `http://localhost:3100` |
| Platform dashboard | `http://localhost:3201` |
| PostgreSQL | `127.0.0.1:5442`, database `radius_development` |
| Redis | `127.0.0.1:6382` |
| OCI registry | `http://127.0.0.1:5002` |
| Authentication issuer and sign-in page | `http://localhost:3100/api/auth`, `/sign-in` |

The Platform API includes Better Auth; no private Cloud service is needed.
Set `RESEND_API_KEY` and `AUTH_EMAIL_FROM` in `.env.local` to your Resend key
and verified sender. Never commit the populated file. The service fails at
startup if Resend delivery is selected without these values. Local development
creates one private persistent signing secret at `.radius/auth-secret`; other
deployments must supply `BETTER_AUTH_SECRET` explicitly.
On Windows, set `BETTER_AUTH_SECRET` explicitly as well: automatic private-file
creation requires POSIX permissions. The desktop itself currently targets macOS.

For a contributor without an email-service account, Mailpit is an optional
local test inbox. Start it explicitly:

```sh
docker compose --env-file .env.local -p radius-local \
  -f hosting/docker/compose.dev.yml --profile mailpit up -d mailpit
```

Then set `RADIUS_AUTH_EMAIL_PROVIDER=smtp`,
`RADIUS_AUTH_SMTP_URL=smtp://127.0.0.1:1025`, and
`AUTH_EMAIL_FROM=Radius <auth@radius.localhost>` in `.env.local`. Read codes at
`http://localhost:8025`; they are not sent to an external mailbox. Keep this
inbox loopback-only and never use it to verify real email ownership in a shared
or production environment. Resend does not require Mailpit.

If you change a dependency port, update both its `RADIUS_*_PORT` value and the
corresponding URL in `.env.local`. The Platform API is a different service
from the private Cloud API, which also defaults to port 3100. Stop or relocate
the conflicting service before starting Platform.

## Start dependencies

```sh
docker compose --env-file .env.local -p radius-local \
  -f hosting/docker/compose.dev.yml up -d --build postgres jobs-redis registry
docker compose --env-file .env.local -p radius-local \
  -f hosting/docker/compose.dev.yml ps
```

The explicit `radius-local` Compose project keeps these volumes separate from
other development stacks. PostgreSQL and Redis should become healthy. The
registry should answer:

```sh
curl --fail http://127.0.0.1:5002/v2/
```

When supplying dependencies yourself, create a `radius_development` database
owned by the configured user, then set `DATABASE_URL`, `JOBS_REDIS_URL`, and
the registry settings in `.env.local`. Default contributor auth requires the
database and Platform server to bind to loopback. Other deployment topologies
use the explicit auth setup described below.

## Start services

Open a terminal for each command, all at the repository root:

```sh
# Platform API. Applies checked-in Platform migrations and seeds local fixtures.
bun run platform:dev
```

```sh
# Deployment/outbox worker. Required when exercising builds and deployments.
bun run platform:jobs:dev
```

```sh
# Dashboard. Uses the local development token from .env.local.
PORT=3201 bun run platform:web:dev
```

```sh
# Desktop. Builds the browser integration and verifies native auth discovery.
bun run dev
```

`RADIUS_LOCAL_DEVELOPMENT=true` selects the existing local `dev` organization
fixture and an automatically registered local public OAuth client. No organization slug, vendor
agent ID, client registration, or private Cloud checkout is required from a
contributor. The first successful email-code login binds the local developer account;
a different identity cannot take over that account later. Development auth is
rejected on production/shared servers and non-loopback databases.

The desktop opens `http://localhost:3100/sign-in` in your browser. Better Auth
inside Platform authenticates your identity; Resend only delivers the email.
Workspace history, sync records, and artifacts go to the local Platform.
Its identity-only token is not supplied to arbitrary example agents.
The server trusts its own development desktop client, so it does not ask you
to consent to sharing your identity with Radius itself. That trust does not
grant membership in another organization. Unrelated clients still require
explicit consent.
Agents with their own provider authentication still use that flow. A company
distribution retains its configured organization, agent, and OAuth credential.

The dashboard's local fixture token and the desktop's browser sign-in serve
different development entry points. To test production-style dashboard OIDC,
follow the [authentication guide](vendor-authentication.md).

## Run an example agent

The native development transport does not require a microVM image. In one
terminal, start the example's process:

```sh
bun run --cwd examples/typescript-agent agent:dev
```

In another terminal, register that process with the running desktop:

```sh
bun run --cwd packages/cli build
(cd examples/typescript-agent && node ../../packages/cli/dist/cli.js dev)
```

The CLI reads `examples/typescript-agent/radius.config.ts`. Its `dev` command
registers the independently running agent; it does not start the agent process.
Use Node for the CLI executable; its TypeScript configuration loader uses Node's
module hooks. The agent itself can run through the example's Bun scripts.
Use the desktop to select the example and send a prompt. For immutable agent
packaging and the macOS runtime, see the [example README](../../examples/typescript-agent/README.md)
and [FX bundling guide](bundling-fx.md).

## Verify and troubleshoot

```sh
curl --fail http://localhost:3100/health
bun run auth:check http://localhost:3100/
bun run --cwd apps/platform-api typecheck
bun run --cwd apps/platform-api test
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop test
```

- **Native-auth endpoint returns 404:** the URL reaches the wrong service.
  A healthy private Cloud API does not satisfy the Platform contract.
- **503 or discovery failure:** check the issuer's availability and explicit
  auth configuration. A custom issuer failure never falls back to hosted auth.
- **Invalid OAuth client/resource:** embedded mode registers the configured
  client and resource after migrations. In external mode the operator must
  register matching values at that issuer; do not paste client secrets into
  the desktop.
- **No email:** check the API's safe delivery status. “Resend accepted” is not
  proof of inbox delivery; check Spam and the provider dashboard. Failed
  delivery returns an error, not a successful code-sent screen. Resend's
  send-only keys cannot inspect delivery history.
- **Sign-in expired:** restart from Radius to get fresh state and PKCE material.
  The native callback and embedded authorization window are bounded to 15
  minutes; the newest email code expires after 10 minutes. Old browser tabs
  cannot complete a newer attempt.
- **Database authentication failure after changing env values:** PostgreSQL
  initializes users/passwords only on first volume creation. Restore the original
  values or change the database credentials deliberately; restarting does not
  rewrite them.
- **No agents:** start and register an example as above, or prepare a bundled
  agent. Authenticating the application does not download an agent.
- **Another local identity owns this installation:** use the original account.
  Do not delete the encrypted desktop profile to work around this error.

## Use your organization's auth configuration

Set `RADIUS_LOCAL_DEVELOPMENT=false`, disable
`RADIUS_PLATFORM_BOOTSTRAP_DEV_AUTHORITY`, and supply the provisioned
organization's native config with `RADIUS_NATIVE_AUTH_CONFIG_FILE` or
`RADIUS_NATIVE_AUTH_CONFIG`. Override `issuer` for your Better Auth instance or
OIDC provider, or omit it for hosted Better Auth. See
[organization authentication](vendor-authentication.md) for provisioning,
membership, callbacks, and agent audiences. Production deployments use the
[self-hosting guide](../self-hosting/README.md).

To use an external issuer while retaining the local contributor fixture, set
`RADIUS_AUTH_MODE=external` and `RADIUS_AUTH_ISSUER` to that provider. Omitting
the external issuer selects hosted Better Auth. Embedded mode never silently
falls back to Cloud. A Google button is available only when both
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are configured for this local
issuer's `/api/auth/callback/google`; Google is not required for email login.

## End-to-end auth regression check

```sh
bun --env-file=.env.local apps/platform-api/scripts/verify-embedded-auth.ts
```

This creates an isolated temporary database on the explicitly configured
loopback PostgreSQL server, applies the checked-in migrations, uses an injected
test-only email delivery function, and checks OTP, consent, native exchange,
refresh, replay protection, owner isolation, and logout. It removes only that
temporary database afterward and never sends real email. It does not replace
verification of your real Resend delivery or packaged desktop.

## Stop services

Stop each Bun process with Ctrl-C, then stop the dependency containers:

```sh
docker compose --env-file .env.local -p radius-local \
  -f hosting/docker/compose.dev.yml stop postgres jobs-redis registry
```

This preserves the PostgreSQL and registry volumes. Do not add volume-deletion
flags unless you intentionally want to erase that development environment.
