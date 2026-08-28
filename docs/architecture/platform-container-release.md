# Platform container release boundary

**Status:** Release workflow and local source verification implemented; no GHCR
package, tag, signature, or GitHub release has been published

**Date:** 2026-08-26

## Release unit

One `platform-vMAJOR.MINOR.PATCH` tag represents exactly four Radius-owned,
multi-architecture images built from the same commit:

```text
ghcr.io/curve-ai/radius-platform-api
ghcr.io/curve-ai/radius-platform-jobs
ghcr.io/curve-ai/radius-platform-web
ghcr.io/curve-ai/radius-postgres
```

The API, jobs worker, web dashboard, and PostgreSQL boundary are not released
independently. The self-host Compose file selects one exact `RADIUS_VERSION`
for all four images. It never follows `latest` or a branch tag.

Third-party Caddy, OCI Distribution, and Valkey images remain upstream images
pinned by multi-architecture digest in Compose. Radius does not mirror or
relicense them.

## Publication workflow

`.github/workflows/platform-images.yml` runs only for a
`platform-vMAJOR.MINOR.PATCH` tag and:

1. validates the semantic version;
2. builds each Radius image for Linux amd64 and arm64;
3. publishes only the exact version tag to GHCR;
4. attaches max-level BuildKit provenance and an SBOM;
5. signs the immutable image digest with keyless Cosign identity;
6. resolves all four registry digests into `platform-images.json`; and
7. creates a draft GitHub release containing that image manifest and its
   SHA-256 checksum.

The workflow actions are pinned to reviewed commit SHAs. Build arguments contain
no credentials. Authentication uses the repository-scoped `GITHUB_TOKEN`, and
keyless signing receives only the job's OIDC identity.

The draft is intentionally not published automatically. GHCR packages default
to private on first publication. A maintainer must verify all four package
visibilities, signatures, attestations, manifest digests, and clean-install
smoke results before publishing the release.

## Source and released modes

`hosting/docker/compose.self-host.yml` is the released distribution. It pulls
the four images from `RADIUS_IMAGE_REGISTRY` (default `ghcr.io/curve-ai`) at the
exact `RADIUS_VERSION`.

`hosting/docker/compose.self-host.source.yml` is a deliberate source-build
overlay. It replaces those references with locally built images from the
current checkout. The destructive `platform:self-host:verify` command always
uses this overlay so uncommitted source is what gets tested.

## Release gates

Before publishing the draft release:

- the tagged commit passes the full CI matrix;
- `bun run release:platform-images:verify` builds and inspects all four local
  amd64/arm64 OCI indexes;
- `bun run platform:self-host:verify` passes from a clean checkout;
- all four GHCR manifests contain amd64 and arm64 images;
- `platform-images.json` matches the GHCR manifest digests;
- Cosign verifies each digest against the repository workflow identity;
- SBOM and provenance attestations exist for every digest;
- all four packages are public and anonymously pullable;
- the released Compose stack, without the source overlay, passes bootstrap,
  deployment, worker, dashboard, and paired recovery checks; and
- rollback uses the previous coherent version plus its paired data backup.

Publishing npm, PyPI, desktop, or Cloud artifacts is a separate release action.
No container release grants authority to publish those artifacts.

Local verification does not prove GHCR visibility, keyless signatures, or
registry-hosted attestations. Those gates can only be checked after the explicit
tag-triggered publication job and before the draft release is made public.
