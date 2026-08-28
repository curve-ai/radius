# Platform management UI provenance

**Status:** Implemented extraction record
**Date:** 2026-08-25

## Source authority

The Radius Platform management UI began from pre-existing first-party Curve UI
source. Curve owns that source and has intentionally relicensed the extracted
customer-product surface under the Radius repository's MIT License. No hosted
infrastructure implementation, private customer data, secret, or third-party
application source was transferred with it.

## Extracted surface

The initial extraction includes:

- the shared warm light/dark product tokens and reusable React primitives;
- the responsive workspace shell, navigation, compact platform panel, and
  keyboard/accessibility behavior;
- customer-facing overview, agent/deployment, and settings routes;
- per-agent release inventory and environment deployment-history routes; and
- a server-only adapter to the public `@curve-ai/platform-client` package.

The extracted application lives at `apps/platform-web`. Its customer-visible
data comes from the open Platform API; project and agent are the same product
identity.

## Explicit exclusions

The extraction excludes:

- marketing pages and editorial content;
- hosted billing and commercial packaging;
- Curve operator and fleet-management surfaces;
- private authentication implementations and parent-domain sessions;
- tRPC and other private application backends; and
- Cloud registry credentials, topology, deployment configuration, and secrets.

Managed hosting may wrap the open application with a host-only session
exchange, but the application must continue to operate against a compatible
self-hosted Platform API without a Curve Cloud account.

## Verification boundary

The extracted application has been typechecked, linted, and built in production
standalone mode. Its overview, agent/deployment, settings, light/dark, compact
tool panel, and mobile routes were exercised against the real open API,
PostgreSQL authority, registry, OIDC browser-session, and role-aware membership
flows. The source-built Docker Compose self-host verifier proves durable
deployment inventory and paired database/registry recovery. Publication of a
versioned release remains a separate explicit action.

The agent detail route was additionally checked against a real development
release in dark desktop, light desktop, and 390x844 mobile layouts. It had no
horizontal overflow or browser errors. Temporary viewport and theme overrides
were reset after verification.
