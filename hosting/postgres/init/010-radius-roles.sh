#!/usr/bin/env bash
set -euo pipefail

for name in RADIUS_MIGRATOR_PASSWORD RADIUS_APP_PASSWORD RADIUS_JOBS_PASSWORD RADIUS_READONLY_PASSWORD; do
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required" >&2
    exit 1
  fi
done

psql \
  --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=database_name="$POSTGRES_DB" \
  --set=migrator_password="$RADIUS_MIGRATOR_PASSWORD" \
  --set=app_password="$RADIUS_APP_PASSWORD" \
  --set=jobs_password="$RADIUS_JOBS_PASSWORD" \
  --set=readonly_password="$RADIUS_READONLY_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE radius_migrator LOGIN PASSWORD %L', :'migrator_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'radius_migrator') \gexec

SELECT format('CREATE ROLE radius_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'radius_app') \gexec

SELECT format('CREATE ROLE radius_jobs LOGIN PASSWORD %L', :'jobs_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'radius_jobs') \gexec

SELECT format('CREATE ROLE radius_readonly LOGIN PASSWORD %L', :'readonly_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'radius_readonly') \gexec

GRANT CONNECT, CREATE ON DATABASE :"database_name" TO radius_migrator;
GRANT CONNECT ON DATABASE :"database_name" TO radius_app, radius_jobs, radius_readonly;
SQL
