# Embedded Platform authentication

Status: approved in this task, with Resend as the default delivery provider and
Mailpit optional for contributors/tests. Implementation and local verification
are in progress; no production Radius migration or release is implied.

## Objective

A contributor can run the public Radius repository with its documented local
dependencies and authenticate without a Curve account or private Cloud code.
The existing Platform process serves both product APIs and Better Auth on
port 3100. Hosting topology does not select a different desktop protocol.

## Runtime and configuration

- Mount Better Auth at `/api/auth/*` in the existing Hono Platform service.
  Serve discovery, signing keys, and the browser sign-in/consent experience
  from the same origin. Reuse Radius visual primitives and auth patterns.
- Use the same native authorization-code flow with S256 PKCE, nonce, exact
  callback matching, resource binding, and Platform-issued sessions.
- Add explicit `embedded` and `external` auth modes. The contributor sample
  selects embedded auth at `http://localhost:3100/api/auth`. External mode
  resolves an explicit Better Auth/OIDC issuer, falling back to the hosted
  issuer only when that external issuer is omitted. Invalid explicit config
  fails closed. Do not silently switch issuers during an outage.
- Register the development public client and local resource idempotently
  after migrations. Do not require a contributor to choose an organization
  slug or register a client manually. Retain the local `dev` fixture.
- Default local authentication is email OTP delivered through operator-configured
  Resend. An optional loopback-only Mailpit inbox is supplied by dependency
  Compose for local tests; only that test mode avoids external email delivery.
  Mailpit is development-only and proves possession of that local inbox, not
  ownership of a public mailbox. The existing strict loopback and isolated-DB
  guards remain mandatory for development owner bootstrap.
- Google is optional and requires operator-owned OAuth configuration whose
  allowed callback points to this issuer. Do not reuse production credentials
  or route local identity through Cloud merely to enable Google.
- Self-hosted embedded mode uses the same module with configured SMTP and/or
  Google. External mode works with hosted Better Auth or another OIDC issuer.
  Organizations, membership and agent audiences remain server-authoritative.
- PostgreSQL, Redis and the registry remain explicit dependencies. Add
  Mailpit to the documented local setup; app launch does not manage Docker.
- Keep the implementation in public Radius. No dependency on private Cloud
  code, Cloud organization provisioning, billing, or hosted-service tables.

## Proposed database boundary

Add `radius_auth` in the same configured PostgreSQL database. It owns identity
provider records only. Existing `radius_platform` accounts, identities,
organizations, memberships, sessions, and all `radius_sync` records remain
unchanged. No backfill, destructive migration, or production data migration
is proposed.

Use the standard Better Auth core, JWT and OAuth Provider models for the
pinned compatible package version, with explicit Drizzle mappings. The
logical subjects and constraints to approve are:

| Record | Principal fields and relationships |
| --- | --- |
| User | Stable opaque ID; name; unique normalized email; verified flag; optional image; creation/update times. |
| Provider account | Stable ID; mandatory user FK; provider/issuer and provider subject; unique provider identity; optional encrypted provider credentials and their expiry. |
| Auth session | Stable ID; mandatory user FK; unique session token representation; expiry/update times; optional IP and user agent. Distinct from a Platform session. |
| Verification | Stable ID; indexed lookup identifier; bounded-lifetime verification/authorization material; expiry and creation/update times. |
| Signing key | Stable ID; public key; encrypted private key; algorithm; creation/retirement times. Retain public verification material through token expiry. |
| OAuth client | Stable ID and unique public client ID; registered redirects, scopes, grant/auth methods; PKCE requirement; disabled/consent policy; optional owner FK and protected secret. |
| OAuth resource | Stable ID; unique resource identifier; allowed scopes; token TTL/signing policy; disabled state. |
| Client-resource grant | Stable ID; client/resource FKs; unique client-resource pair. No implicit access to other resources. |
| OAuth refresh token | Stable ID; unique protected token representation; mandatory user/client FKs; optional session FK; resource/scopes; expiry, revocation and rotation/replay state. |
| OAuth access token | Stable ID; unique protected token representation; client FK; optional user/session/refresh-token FKs; resource/scopes; expiry and revocation state. |
| OAuth consent | Stable ID; client FK and applicable user/reference subject; granted scopes and timestamps. |
| OAuth client assertion | Unique assertion ID and expiry for replay protection. No client-credentials grant enabled by default. |

Use upstream-compatible representations for protocol metadata such as scopes,
redirects and resources; these are deliberately not product relationship
tables. Product memberships are not duplicated in Better Auth.

Foreign-key and expiry lookup indexes are included. Referential integrity is
enforced in PostgreSQL. Provider accounts, sessions, consents and OAuth grants
are dependent auth state and cascade when their owning auth user/client is
explicitly deleted; nullable historical session references use SET NULL where
the upstream model requires it. Client-resource grants cascade with their
client/resource. Deleting auth records never cascades into Platform or sync
data. Account deletion is not exposed as a new product operation in this work.

Map verified `(issuer, subject)` through existing Platform `account_identities`.
Do not merge accounts merely because their emails match. Changing issuer must
not silently transfer a previously bound local owner or reset the desktop
profile. Local first-owner binding stays serialized and one-time; ordinary
self-hosted users need provisioned membership/explicit joining policy.

Keep OTPs and reusable credentials out of logs. Use provider-supported hashing
for verification/token material where available and encryption for recoverable
provider tokens/private keys. Keep host-only cookies, origin/CSRF checks,
rate limits, bounded expiry and explicit trusted origins. Redis can provide
namespaced rate-limit state without adding another relational table; OAuth
requires persisted auth sessions even when secondary storage is enabled.

## Timeout and return-path work

Observed: the desktop displays `AUTH_TIMEOUT`; its current callback listener
has a hard five-minute lifetime. Google sign-in alone is not evidence of a
successful native callback or Platform token exchange.

Verify and repair the complete sequence: authorize -> login -> consent when
needed -> loopback callback -> Platform exchange -> workspace ready. Preserve
the signed authorization context across every browser step. A bounded login
window must allow normal interactive login; expiry/cancel closes the listener,
and retry creates fresh state/nonce/PKCE material. Old callbacks must never
complete a newer attempt. Do not fix this by accepting late codes unchecked
or making the listener immortal.

## Acceptance checks after approval

1. Review generated additive schema against this model before applying it;
   request renewed approval for material changes. Apply only to the named
   local development database during this task.
2. Cold-start the documented dependency stack and embedded service using the
   existing checkout. No Cloud account, Google secret or private repo needed.
3. Complete email-OTP native login using the authorized Shishlyannikov email
   and the local inbox. Verify the callback, local account/session and workspace
   readiness; keep the existing desktop profile and conversations.
4. Test wrong state, cancellation, expiry, port reuse, retry, old callbacks,
   OTP rejection, refresh, restart persistence and sign-out.
5. Verify membership isolation, disabled users, second-owner rejection and
   no credential forwarding to arbitrary example agents.
6. Verify explicit external issuer mode remains supported without changing
   the desktop bundle; test Google only with valid local provider setup.
7. Rebuild and launch the updated bundle and complete a harmless example-agent
   prompt. Report native login and agent execution separately.

## References

- [Better Auth Hono integration](https://better-auth.com/docs/integrations/hono)
- [Better Auth database models](https://better-auth.com/docs/concepts/database)
- [OAuth Provider setup, redirects and schema](https://better-auth.com/docs/plugins/oauth-provider)
