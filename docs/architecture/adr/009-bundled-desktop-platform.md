# ADR-009: Bind each desktop bundle to one Radius Platform origin

**Status:** Accepted
**Date:** 2026-09-12
**Deciders:** Radius maintainers

## Context

The desktop previously exposed separate Curve Cloud and self-hosted connection
paths. That duplicated endpoint selection and browser-session authentication in
the renderer after native bundle authentication became the authoritative app
entry point. It also let the installed app start without knowing which Platform
owned its identity, agent credential, connector catalog, and sync service.

## Decision

Every Radius desktop bundle contains one validated Platform base URL. The
standard Radius bundle uses `http://localhost:3100/`. A branded distribution
embeds its operator-provided URL alongside its application identity and may pin
the expected organization and agent.

The desktop uses the same native OIDC, Platform session, agent credential,
connector catalog, and sync paths for managed and self-hosted installations.
Hosting mode is not a desktop choice and does not change client behavior. The
renderer does not receive endpoint-selection, connect, disconnect, or sync-toggle
IPC methods, and Settings does not expose Platform topology.

The standard bundle accepts the organization and agent from the native auth
configuration served by its Platform origin. A branded distribution verifies
those server values against the organization and agent embedded in the bundle.
All workspace IPC and agent runs remain locked until native authentication is
ready.

Development may override the embedded URL with `bun run dev --url <origin>`.
Packaged applications use their build-time URL.

## Consequences

- Radius remains independent of Curve Cloud because the default target is a
  locally operated, open Radius Platform.
- A user never types a Platform URL into the installed app or chooses how it is
  hosted.
- Native authentication must be configured at the bundle's Platform origin
  before the workspace can open.
- Local storage remains canonical and encrypted on the device, while sync starts
  automatically after native authentication.
- The earlier optional desktop provider picker in ADR-005 is superseded. The
  public sync protocol and local-first data model remain in effect.

## Validation

1. Build without configuration and verify the main bundle contains
   `http://localhost:3100/`.
2. Build a branded distribution and verify its validated Platform origin is
   embedded.
3. Verify managed and self-hosted origins use the same native auth and bearer
   sync path.
4. Verify signed-out renderer IPC and agent runs remain denied.
5. Verify Settings contains no Platform URL, hosting-mode choice, or sync toggle.
