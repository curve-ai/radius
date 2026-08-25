# Radius Platform PostgreSQL

This is the pinned, minimal PostgreSQL distribution for the self-hosted Radius
Platform. It derives from the official PostgreSQL 18.6 Bookworm image and
installs no extensions or Supabase services.

The bootstrap creates separate owner, migrator, API, jobs, and read-only roles.
Application tables and grants are created only by the reviewed migrations in
`packages/platform-database/migrations`.

```bash
cp postgres.env.example postgres.env
chmod 600 postgres.env
docker compose -f compose.yml up -d
```

PostgreSQL binds to loopback only. Production secrets belong in the operator's
secret manager; `postgres.env` is ignored and must never be committed.
