# Radius Platform Web

This is the open-source customer management interface for both self-hosted
Radius and Curve Cloud. It is intentionally part of Radius: a self-hosted
installation receives the same agent, deployment, device, and organization
management product surface as the managed service.

The current workspace includes organization overview, agent inventory,
per-agent environment state, immutable deployment inventory, append-only
environment history, managed device/client/agent installation state, role-aware
promotion and rollback controls, developer-token management,
organization-member administration, and Platform settings.
Collection reads are rendered in Server
Components so Platform credentials never enter the browser bundle.

The application consumes only the public `@curve-ai/platform-client` contract.
It does not import Cloud code or contain billing, marketing, fleet operations,
provider credentials, or Curve infrastructure configuration.

## Local development

Start the open development registry and API from the Radius repository root:

```bash
npx bun@1.3.14 run platform:infra:up

PORT=3110 \
RADIUS_PLATFORM_DEV_TOKEN=dev-token \
RADIUS_PLATFORM_REGISTRY=127.0.0.1:5001 \
npx bun@1.3.14 run --cwd apps/platform-api start
```

Then start this application in another terminal:

```bash
RADIUS_PLATFORM_API_URL=http://127.0.0.1:3110 \
RADIUS_PLATFORM_ACCESS_TOKEN=dev-token \
npx bun@1.3.14 run platform:web:dev
```

Open `http://127.0.0.1:3200`. The access token is read by the Next.js server
only. Never place it in a `NEXT_PUBLIC_*` variable.

Internal container networks may set
`RADIUS_PLATFORM_ALLOW_INSECURE_API=true` with an explicit HTTP service origin.

## Browser-session mode

`RADIUS_PLATFORM_AUTH_MODE=browser-session` is the default outside the
development Compose profile. Unauthenticated workspace requests redirect to
the compact `/login` surface; the login action starts the Platform API OIDC
flow using `RADIUS_PLATFORM_PUBLIC_API_URL`. Server Components forward the
HttpOnly cookie only to `/auth/session`, render the returned account and
memberships, and expose a POST-only Sign out action that revokes the session.

Server Components forward that same cookie to Platform read routes; the API
joins the account to active organization memberships for every organization or
agent read. No service token is used in browser-session mode.
`development-token` mode remains an explicit local-only option. Browser writes
use role-aware API rules for developer-token management and deployment changes.
Accounts with multiple memberships receive a validated organization selector;
its non-secret slug cookie is cleared on logout.
External Platform profiles and public origins should use HTTPS.

Owners and admins can create and revoke scoped developer tokens in Settings.
The new secret is returned once through Server Action state and is never placed
in a URL, cookie, log, or persisted idempotency response. Owners, admins, and
developers can promote or roll back verified immutable deployments from the agent
detail page. Each mutation rechecks the selected organization and current
deployment revision on the server. Viewers receive the same read-only inventory
without mutation controls.

Settings also gives owners a compact membership inventory with role, access
state, identity, and developer-token count. Owners can change another member's
role, suspend or restore access, and remove access with confirmation. The
current owner row is intentionally immutable; lifecycle and final-owner
invariants remain enforced by the API even when requests bypass the dashboard.

The development Compose profile uses the durable PostgreSQL provider and an
explicit fixture token. Browser-session mode uses hashed sessions and direct
membership authorization without that fixture.

## Verification

```bash
npx bun@1.3.14 run --filter @curve-ai/radius-platform-web typecheck
npx bun@1.3.14 run --filter @curve-ai/radius-platform-web lint
npx bun@1.3.14 run --filter @curve-ai/radius-platform-web build
```

The production build uses Next.js standalone output so the same application
can be packaged for self-hosting or run by Curve Cloud.
