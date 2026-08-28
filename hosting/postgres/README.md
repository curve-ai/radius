# Radius PostgreSQL image

The self-hosted Platform starts from the official PostgreSQL image, pinned by
version and multi-architecture digest. It does not use the Supabase Postgres
base image, roles, initialization, services, or upgrade behavior.

The initial Radius image intentionally adds no extension packages and creates
no extensions. `extensions.lock` is the authority for future additions. Every
extension requires an exact source, version, checksum, license, build method,
upgrade policy, and a separately approved schema migration before it can be
enabled.

Build and verify:

```bash
docker build -f hosting/postgres/Containerfile -t radius-postgres:dev .
bash hosting/postgres/verify.sh radius-postgres:dev
```

Updating the official base requires verifying the current Docker Official
Image manifest, recording its exact version and multi-platform digest in both
the Containerfile and `extensions.lock`, building on arm64 and amd64, and
running the clean-start and future migration/restore checks.
