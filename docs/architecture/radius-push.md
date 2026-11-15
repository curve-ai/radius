# `radius push`: secure image upload

**Status:** Implemented

**Date:** 2026-11-06

`radius build` produces an OCI image of an agent. `radius push` uploads that
image through the platform. The image becomes a version on the dashboard
agent page that is not live until someone promotes it there.

The upload is protected in three ways:

- **Encrypted in transit.** The CLI refuses a registry that Docker would reach
  over plain HTTP, unless the registry is on the same machine (loopback).
- **One password per upload.** Each upload gets its own registry password,
  valid for 60 minutes.
- **One repository per password.** The registry accepts only 5-minute tokens
  signed by the platform. A token from an upload password can push to and
  pull from that upload's repository only.

## What changed

| Area                                | Before                                            | After                                                                |
| ----------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| Uploading from the CLI              | Not possible                                      | `radius push` uploads the latest build as a version that is not live |
| Registry password from `prepare`    | One static password for every deployer and upload | A password for one upload only (`upload-<uploadId>`)                 |
| How long the password works         | Forever                                           | Until the upload expires (60 minutes)                                |
| What the password can push to       | Every agent's repository                          | Only that upload's repository                                        |
| Upload window (`expiresAt`)         | 15 minutes, checked only by the client            | 60 minutes, enforced by the platform                                 |
| Pushing the same build again        | Not possible                                      | Same version within 60 minutes; a second version (not live) after    |
| Registry login (self-host)          | Password checked against an htpasswd file         | `docker login` gets a 5-minute token from the platform               |
| Plain-HTTP registry                 | Upload goes ahead if Docker allows it             | Refused unless the registry is loopback                              |
| Platform checking an uploaded image | Sends the static password                         | Signs its own 5-minute pull token for that repository                |
| Self-host setup                     | htpasswd file plus registry username and password | A signing key pair (`RADIUS_REGISTRY_TOKEN_KEY` and `_CERT`)         |
| Dev stack (`compose.dev.yml`)       | No registry auth                                  | No registry auth (unchanged)                                         |

Unchanged: the `prepare` and `finalize` request and response shapes, the
platform services interface, the database schema, and the dashboard's
promote flow.

## Flow

```
radius push
  ├─ 1. read radius.json and .radius/builds/latest.json (the build receipt)
  ├─ 2. platform: info, then the access token's organization
  ├─ 3. platform: prepare ──► { registry, username: upload-<id>, password, expiresAt }
  ├─ 4. upload with Docker
  │      ├─ refuse if Docker would use plain HTTP (`docker info`)
  │      ├─ docker login ──► registry sends Docker to the platform's token endpoint
  │      │                   platform checks the upload password, returns a token
  │      └─ docker push  ──► registry checks the token's signature, expiry and scope
  └─ 5. platform: finalize(promote: false)
         └─ platform checks the image by digest with a pull token it signs itself
```

On the dev stack the registry has no auth, so step 4 has no token exchange.

## CLI

`radius push` (`packages/cli/src/commands/push/`) reads the platform address
and access token from `RADIUS_API_URL` and `RADIUS_ACCESS_TOKEN`, or
`--api-url` and `--token`. Other flags: `--build <digest>`, `--environment`
(default `production`), `--organization`, `--json`.

- The access token needs `deployment.write` in the organization. It can push
  to any agent in that organization.
- If `radius.json` changed since the build, the command stops and asks for a
  new `radius build`.
- `prepare` uses the key `prepare-<organization>-<buildDigest>-<environment>`,
  so re-running a push replays the same upload. If that upload has expired,
  the CLI asks for a new one with the key `prepare-after-<expired uploadId>`.
  After 20 expired replays in a row it stops and asks the user to check the
  computer's clock.

The upload logic is in `packages/cli/src/platform-push.ts`.

## HTTPS check

Docker decides whether a registry is reached over HTTP or HTTPS, so the check
asks Docker (`packages/agent-build/src/push.ts`). Before `docker login`, for a
registry that is not loopback:

1. Read `docker info --format '{{json .RegistryConfig}}'`; refuse if it can't
   be read.
2. Refuse if `IndexConfigs[<registry>].Secure` is `false` (names compared
   ignoring letter case).
3. Refuse if the registry's address falls in `InsecureRegistryCIDRs` beyond
   Docker's loopback defaults. A hostname is resolved only when such networks
   are configured.

Loopback means `localhost`, `*.localhost`, `127.0.0.0/8` and `::1`, with any
port.

## Upload password

When the token key is configured, `prepare` returns
`username = upload-<uploadId>` and
`password = base64url(HMAC-SHA256(uploadKey, uploadId))`. `uploadKey` comes
from the signing key's private value through HKDF-SHA256. Nothing is stored,
and a replayed `prepare` returns the same password.

Without the key (dev), `prepare` returns the configured static credentials.

## Token endpoint

`GET /api/platform/v1/registry/token` (`apps/platform-api/src/registry-token.ts`)
follows the Docker Registry token spec with HTTP Basic auth. It is mounted
only when the key is configured, before the platform's Bearer-auth check.

| Request                                                                | Result                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------- |
| Correct upload password, upload `prepared` or `finalized`, not expired | Token with `push,pull` on that upload's repository only |
| Same, with no scope (what `docker login` sends)                        | Token with no access, so login succeeds                 |
| Wrong password, expired or failed upload, any other username           | 401                                                     |

The token is an ES256 JWT signed with `node:crypto`, with the certificate in
its `x5c` header. Claims: `iss=radius-platform`, `sub=upload-<uploadId>`,
`aud=<registry name>`, `exp = min(now + 5 minutes, upload expiry)`, and the
granted `access`. There is no `refresh_token`.

A finalized upload's password keeps working until the upload expires, so a
re-run of the same push succeeds. It reaches only the same agent's
repository, and versions are registered by digest, so a later push to a tag
cannot change a registered version.

## Image checks

After an upload, platform-api and platform-jobs check that the image exists
by digest. With the key configured, each signs its own `pull` token for that
one repository (`registryPullAuthorization` in
`packages/platform-providers/src/registry-token.ts`). The token's audience is
the registry's public name (`RADIUS_REGISTRY_DOMAIN`), not its internal
address. Without the key, they send the static Basic credentials.

## Self-host configuration

The registry in `hosting/docker/compose.self-host.yml` runs in token mode:

```yaml
REGISTRY_AUTH: token
REGISTRY_AUTH_TOKEN_REALM: ${RADIUS_REGISTRY_TOKEN_REALM:-https://${RADIUS_PLATFORM_DOMAIN}/api/platform/v1/registry/token}
REGISTRY_AUTH_TOKEN_SERVICE: ${RADIUS_REGISTRY_DOMAIN}
REGISTRY_AUTH_TOKEN_ISSUER: radius-platform
REGISTRY_AUTH_TOKEN_ROOTCERTBUNDLE: /auth/token.crt
```

platform-api and platform-jobs read the key and certificate from
`/run/radius/`. A missing file stops the stack at startup. The key file and
certificate file may each hold several entries, so the key can be rotated
without breaking uploads in progress.

Creating the key pair, rotating it, and upgrading an htpasswd install are in
the [self-hosting guide](../self-hosting/README.md).

## Limits

- Images are encrypted in transit, not at rest. Keep the registry volume on
  an encrypted disk or encrypted cloud storage.
- An upload that takes longer than 60 minutes fails.
- Access tokens cover every agent in their organization; per-agent tokens
  are not implemented.
- Other registries (ECR, Artifact Registry, ACR, Harbor) would need a new
  credential issuer in platform-api; the `prepare` contract and the CLI stay
  the same.

## Testing

- Unit tests: `apps/platform-api`, `packages/platform-providers`,
  `packages/agent-build` and `packages/cli`. The tests that need key pairs
  call `openssl` and are skipped without it (on Windows, run them from Git
  Bash).
- End to end: `bun run --cwd hosting test:integration` (needs Docker, `jq`
  and `openssl`) checks the Bearer challenge, upload tokens limited to their
  own repository, 401 for wrong or expired passwords, and the backup restore.
