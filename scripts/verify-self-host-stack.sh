#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_PROJECT_NAME="radius-selfhost-verify-${PPID}"
SMOKE_API_PORT="${RADIUS_SMOKE_API_PORT:-3122}"
SMOKE_WEB_PORT="${RADIUS_SMOKE_WEB_PORT:-3212}"
SMOKE_REGISTRY_PORT="${RADIUS_SMOKE_REGISTRY_PORT:-5012}"
SMOKE_HTTP_PORT="${RADIUS_SMOKE_HTTP_PORT:-8082}"
SMOKE_HTTPS_PORT="${RADIUS_SMOKE_HTTPS_PORT:-8445}"
TMP_DIR="$(mktemp -d)"
REGISTRY_IMAGE="registry:2.8.3@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373"
CADDY_IMAGE="caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648"

export RADIUS_VERSION="self-host-verify"
export RADIUS_PLATFORM_DOMAIN="127.0.0.1:${SMOKE_API_PORT}"
export RADIUS_REGISTRY_DOMAIN="127.0.0.1:${SMOKE_REGISTRY_PORT}"
export RADIUS_ACME_EMAIL="verify@example.com"
export RADIUS_POSTGRES_PASSWORD="radius_postgres_verify_abcdefghijklmnopqrstuvwxyz"
export RADIUS_REGISTRY_USERNAME="radius-verify"
export RADIUS_REGISTRY_PASSWORD="radius_registry_verify_abcdefghijklmnopqrstuvwxyz"
export RADIUS_REGISTRY_AUTH_FILE="${TMP_DIR}/registry.htpasswd"
export RADIUS_REGISTRY_HTTP_SECRET="radius_registry_http_verify_abcdefghijklmnopqrstuvwxyz"
export RADIUS_OIDC_TRANSACTION_SECRET="radius_oidc_verify_abcdefghijklmnopqrstuvwxyz"
export RADIUS_OIDC_ISSUER="https://identity.example.com"
export RADIUS_OIDC_CLIENT_ID="radius-self-host-verify"
export RADIUS_OIDC_CLIENT_SECRET="radius_oidc_client_verify"
export RADIUS_OIDC_ORGANIZATION="verify"
export RADIUS_OIDC_ALLOWED_EMAIL_DOMAINS="example.com"
export RADIUS_OIDC_AUTO_JOIN_ROLE="viewer"
export RADIUS_SMOKE_API_PORT="${SMOKE_API_PORT}"
export RADIUS_SMOKE_WEB_PORT="${SMOKE_WEB_PORT}"
export RADIUS_SMOKE_REGISTRY_PORT="${SMOKE_REGISTRY_PORT}"
export RADIUS_HTTP_BIND="127.0.0.1:${SMOKE_HTTP_PORT}"
export RADIUS_HTTPS_BIND="127.0.0.1:${SMOKE_HTTPS_PORT}"

compose=(
  docker compose
  --project-name "${COMPOSE_PROJECT_NAME}"
  -f "${ROOT_DIR}/hosting/docker/compose.self-host.yml"
  -f "${ROOT_DIR}/hosting/docker/compose.self-host.source.yml"
  -f "${ROOT_DIR}/hosting/docker/compose.self-host.smoke.yml"
)

cleanup() {
  local status=$?
  if (( status != 0 )); then
    "${compose[@]}" ps >&2 || true
    "${compose[@]}" logs --tail=150 ingress platform-api platform-jobs platform-web registry >&2 || true
  fi
  "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf -- "${TMP_DIR}"
  exit "${status}"
}
trap cleanup EXIT

for command in docker htpasswd curl jq shasum node; do
  command -v "${command}" >/dev/null || {
    echo "self-host verify: ${command} is required" >&2
    exit 1
  }
done

htpasswd -Bbn "${RADIUS_REGISTRY_USERNAME}" "${RADIUS_REGISTRY_PASSWORD}" \
  > "${RADIUS_REGISTRY_AUTH_FILE}"
chmod 600 "${RADIUS_REGISTRY_AUTH_FILE}"

"${compose[@]}" config --quiet
docker run --rm \
  -e RADIUS_ACME_EMAIL="${RADIUS_ACME_EMAIL}" \
  -e RADIUS_PLATFORM_DOMAIN="agents.example.com" \
  -e RADIUS_REGISTRY_DOMAIN="registry.example.com" \
  -v "${ROOT_DIR}/hosting/docker/Caddyfile.self-host:/etc/caddy/Caddyfile:ro" \
  "${CADDY_IMAGE}" caddy validate --config /etc/caddy/Caddyfile >/dev/null

bun run --cwd "${ROOT_DIR}/packages/cli" build >/dev/null

"${compose[@]}" up -d --build \
  postgres registry jobs-redis platform-api platform-jobs platform-web

"${compose[@]}" up -d ingress
ingress_ready=false
for _attempt in {1..30}; do
  if curl --noproxy '*' -kfsS --resolve "platform.localhost:${SMOKE_HTTPS_PORT}:127.0.0.1" \
    "https://platform.localhost:${SMOKE_HTTPS_PORT}/health" >/dev/null; then
    ingress_ready=true
    break
  fi
  sleep 1
done
[[ "${ingress_ready}" == "true" ]]
curl --noproxy '*' -kfsS --resolve "platform.localhost:${SMOKE_HTTPS_PORT}:127.0.0.1" \
  "https://platform.localhost:${SMOKE_HTTPS_PORT}/api/platform/v1/info" \
  | grep -q '"registryUpload":true'
[[ "$(curl --noproxy '*' -ksS -o /dev/null -w '%{http_code}' \
  --resolve "registry.localhost:${SMOKE_HTTPS_PORT}:127.0.0.1" \
  "https://registry.localhost:${SMOKE_HTTPS_PORT}/v2/")" == "401" ]]
[[ "$(curl --noproxy '*' -ksS -o /dev/null -w '%{http_code}' \
  --resolve "registry.localhost:${SMOKE_HTTPS_PORT}:127.0.0.1" \
  -u "${RADIUS_REGISTRY_USERNAME}:${RADIUS_REGISTRY_PASSWORD}" \
  "https://registry.localhost:${SMOKE_HTTPS_PORT}/v2/")" == "200" ]]

[[ "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${SMOKE_REGISTRY_PORT}/v2/")" == "401" ]]
[[ "$(curl -sS -o /dev/null -w '%{http_code}' \
  -u "${RADIUS_REGISTRY_USERNAME}:${RADIUS_REGISTRY_PASSWORD}" \
  "http://127.0.0.1:${SMOKE_REGISTRY_PORT}/v2/")" == "200" ]]

bootstrap_output="$("${compose[@]}" run --rm --no-deps platform-api \
  bun platform-admin.js bootstrap-owner \
  --organization verify \
  --organization-name "Verify Engineering" \
  --account-name "Initial Owner")"
access_token="$(sed -n 's/.*\(radius_pat_[A-Za-z0-9_-]\{43\}\).*/\1/p' <<<"${bootstrap_output}")"
[[ "${access_token}" =~ ^radius_pat_[A-Za-z0-9_-]{43}$ ]]

member_access_token="radius_pat_mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm"
member_session_token="radius_sess_members_verify_0123456789abcdef0123456789"
member_token_hash="$(printf '%s' "${member_access_token}" | shasum -a 256 | awk '{print $1}')"
member_session_hash="$(printf '%s' "${member_session_token}" | shasum -a 256 | awk '{print $1}')"
docker exec "${COMPOSE_PROJECT_NAME}-postgres-1" \
  psql -U radius -d radius -v ON_ERROR_STOP=1 -c "
    INSERT INTO radius_platform.accounts (account_id, display_name)
    VALUES ('30000000-0000-4000-8000-000000000002', 'Build Engineer');
    INSERT INTO radius_platform.account_identities (
      account_identity_id, account_id, issuer, provider_subject,
      email_normalized, email_verified_at
    ) VALUES (
      '40000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000002',
      'https://identity.verify', 'build-subject', 'build@example.com',
      clock_timestamp()
    );
    INSERT INTO radius_platform.organization_memberships (
      membership_id, organization_id, account_id, role_code
    )
    SELECT '50000000-0000-4000-8000-000000000002', organization_id,
      '30000000-0000-4000-8000-000000000002', 'viewer'
    FROM radius_platform.organizations WHERE slug = 'verify';
    INSERT INTO radius_platform.platform_sessions (
      session_id, account_identity_id, token_hash, token_prefix, expires_at
    ) VALUES (
      '51000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000002',
      decode('${member_session_hash}', 'hex'), 'radius_sess_memb',
      clock_timestamp() + interval '1 day'
    );
    INSERT INTO radius_platform.developer_tokens (
      developer_token_id, membership_id, label, token_hash, token_prefix
    ) VALUES (
      '52000000-0000-4000-8000-000000000002',
      '50000000-0000-4000-8000-000000000002', 'Build read token',
      decode('${member_token_hash}', 'hex'), 'radius_pat_mmmmmm'
    );
    INSERT INTO radius_platform.developer_token_scopes (
      developer_token_id, scope_code
    ) VALUES ('52000000-0000-4000-8000-000000000002', 'agent.read');
  " >/dev/null

radius_cli() {
  local token=$1
  shift
  RADIUS_API_URL="http://127.0.0.1:${SMOKE_API_PORT}" \
    RADIUS_ACCESS_TOKEN="${token}" \
    node "${ROOT_DIR}/packages/cli/dist/cli.js" "$@"
}

members_json="$(radius_cli "${access_token}" members list --organization verify --json)"
[[ "$(jq -r '.memberships | length' <<<"${members_json}")" == "2" ]]
owner_membership_id="$(jq -er '.memberships[] | select(.current) | .id' <<<"${members_json}")"
if radius_cli "${access_token}" members role "${owner_membership_id}" \
  --role admin --organization verify >/dev/null 2>&1; then
  echo "self-host verify: current owner changed its own membership" >&2
  exit 1
fi
if radius_cli "${member_access_token}" members list \
  --organization verify >/dev/null 2>&1; then
  echo "self-host verify: viewer token listed organization members" >&2
  exit 1
fi

radius_cli "${access_token}" members role \
  50000000-0000-4000-8000-000000000002 \
  --role developer --organization verify >/dev/null
[[ "$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${member_access_token}" \
  "http://127.0.0.1:${SMOKE_API_PORT}/api/platform/v1/identity")" == "401" ]]
radius_cli "${access_token}" members suspend \
  50000000-0000-4000-8000-000000000002 --organization verify >/dev/null
[[ "$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Cookie: radius_platform_session=${member_session_token}" \
  "http://127.0.0.1:${SMOKE_API_PORT}/api/platform/v1/auth/session")" == "401" ]]
radius_cli "${access_token}" members restore \
  50000000-0000-4000-8000-000000000002 --organization verify >/dev/null
radius_cli "${access_token}" members remove \
  50000000-0000-4000-8000-000000000002 --organization verify >/dev/null
radius_cli "${access_token}" members restore \
  50000000-0000-4000-8000-000000000002 --organization verify >/dev/null

membership_evidence="$(docker exec "${COMPOSE_PROJECT_NAME}-postgres-1" \
  psql -U radius -d radius -At -F '|' -c "
    SELECT membership.role_code, membership.lifecycle_state,
      (SELECT count(*) FROM radius_platform.audit_events
       WHERE action_code = 'organization_membership.update'),
      (SELECT count(*) FROM radius_platform.idempotency_records
       WHERE operation_code = 'organization_membership.update'),
      (SELECT count(*) FROM radius_platform.developer_tokens
       WHERE developer_token_id = '52000000-0000-4000-8000-000000000002'
         AND revoked_at IS NOT NULL),
      (SELECT count(*) FROM radius_platform.platform_sessions
       WHERE session_id = '51000000-0000-4000-8000-000000000002'
         AND revoked_at IS NOT NULL)
    FROM radius_platform.organization_memberships AS membership
    WHERE membership.membership_id = '50000000-0000-4000-8000-000000000002';
  ")"
[[ "${membership_evidence}" == "developer|active|5|5|1|1" ]]

if "${compose[@]}" run --rm --no-deps platform-api \
  bun platform-admin.js bootstrap-owner \
  --organization second \
  --organization-name Second \
  --account-name Second >/dev/null 2>&1; then
  echo "self-host verify: repeated owner bootstrap unexpectedly succeeded" >&2
  exit 1
fi

deploy_output="$(
  cd "${ROOT_DIR}/examples/typescript-agent"
  RADIUS_API_URL="http://127.0.0.1:${SMOKE_API_PORT}" \
    RADIUS_ACCESS_TOKEN="${access_token}" \
    node ../../packages/cli/dist/cli.js deploy \
      --organization verify \
      --environment staging
)"
deployment_digest="$(sed -n 's/^Digest: //p' <<<"${deploy_output}")"
agent_deployment_id="$(sed -n 's/^Deployment ID: //p' <<<"${deploy_output}")"
[[ "${deployment_digest}" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ "${agent_deployment_id}" =~ ^[a-f0-9-]{36}$ ]]

worker_completed=false
for _attempt in {1..30}; do
  if "${compose[@]}" logs platform-jobs 2>/dev/null | grep -q "completed agent_deployment.verify.v1"; then
    worker_completed=true
    break
  fi
  sleep 1
done
[[ "${worker_completed}" == "true" ]]

client_instance_id="60000000-0000-4000-8000-000000000001"
client_registration="$(curl -fsS -X PUT \
  -H "Authorization: Bearer ${access_token}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: client-register-smoke-1" \
  "http://127.0.0.1:${SMOKE_API_PORT}/api/platform/v1/client-installations/${client_instance_id}" \
  --data-binary "$(jq -nc --arg client "${client_instance_id}" '{
    apiVersion: 1,
    organization: "verify",
    clientInstanceId: $client,
    physicalDevice: {
      fingerprint: ("sha256:" + ("e" * 64)),
      displayName: "Verification device",
      assetTag: "VERIFY-001",
      platform: "linux",
      architecture: "arm64"
    },
    observation: {
      clientEventId: "61000000-0000-4000-8000-000000000001",
      schemaVersion: 1,
      desktopVersion: "0.0.1",
      runtimeVersion: "0.0.1",
      runtimeProtocolVersion: 1,
      state: "ready",
      errorCode: null,
      observedAt: "2026-08-27T16:00:00.000Z"
    }
  }')")"
client_installation_id="$(jq -er '.clientInstallationId' <<<"${client_registration}")"

curl -fsS -X POST \
  -H "Authorization: Bearer ${access_token}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: agent-installation-smoke-1" \
  "http://127.0.0.1:${SMOKE_API_PORT}/api/platform/v1/client-installations/${client_installation_id}/agents/agent_example1/observations" \
  --data-binary "$(jq -nc --arg deployment "${agent_deployment_id}" '{
    apiVersion: 1,
    agentDeploymentId: $deployment,
    clientEventId: "62000000-0000-4000-8000-000000000001",
    schemaVersion: 1,
    state: "ready",
    errorCode: null,
    observedAt: "2026-08-27T16:01:00.000Z"
  }')" >/dev/null

installation_inventory="$(curl -fsS \
  -H "Authorization: Bearer ${access_token}" \
  "http://127.0.0.1:${SMOKE_API_PORT}/api/platform/v1/organizations/verify/installations")"
[[ "$(jq -r '.physicalDevices | length' <<<"${installation_inventory}")" == "1" ]]
[[ "$(jq -r '.physicalDevices[0].clientInstallations[0].agentInstallations | length' <<<"${installation_inventory}")" == "1" ]]

for service in platform-api platform-jobs platform-web; do
  container_id="$("${compose[@]}" ps -q "${service}")"
  [[ -n "${container_id}" ]]
  [[ "$(docker inspect "${container_id}" --format '{{.HostConfig.ReadonlyRootfs}}')" == "true" ]]
  [[ "$(docker inspect "${container_id}" --format '{{.RestartCount}}')" == "0" ]]
done

persisted_secret_count="$(docker exec "${COMPOSE_PROJECT_NAME}-postgres-1" \
  psql -U radius -d radius -At -c \
  "SELECT count(*) FROM radius_platform.idempotency_records WHERE response_body::text ~ 'radius_(pat|sess)_[A-Za-z0-9_-]{20,}';")"
[[ "${persisted_secret_count}" == "0" ]]

docker exec "${COMPOSE_PROJECT_NAME}-postgres-1" \
  pg_dump -U radius -d radius -Fc > "${TMP_DIR}/postgres.dump"
docker exec "${COMPOSE_PROJECT_NAME}-registry-1" \
  tar -C /var/lib/registry -cf - . > "${TMP_DIR}/registry.tar"

"${compose[@]}" stop platform-web platform-api platform-jobs registry >/dev/null
docker exec "${COMPOSE_PROJECT_NAME}-postgres-1" \
  psql -U radius -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE radius" \
  -c "CREATE DATABASE radius OWNER radius" >/dev/null

registry_volume="${COMPOSE_PROJECT_NAME}_radius-registry-data"
[[ "$(docker volume inspect "${registry_volume}" --format '{{.Name}}')" == "${registry_volume}" ]]
docker run --rm -v "${registry_volume}:/data" --entrypoint sh "${REGISTRY_IMAGE}" \
  -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'

docker exec -i "${COMPOSE_PROJECT_NAME}-postgres-1" \
  pg_restore -U radius -d radius --no-owner --no-privileges \
  < "${TMP_DIR}/postgres.dump"
docker run --rm -i -v "${registry_volume}:/data" --entrypoint tar "${REGISTRY_IMAGE}" \
  -C /data -xf - < "${TMP_DIR}/registry.tar"

"${compose[@]}" up -d registry platform-api platform-jobs platform-web >/dev/null

restored_deployments="$(docker exec "${COMPOSE_PROJECT_NAME}-postgres-1" \
  psql -U radius -d radius -At -c "SELECT count(*) FROM radius_platform.agent_deployments")"
[[ "${restored_deployments}" == "1" ]]
restored_revisions="$(docker exec "${COMPOSE_PROJECT_NAME}-postgres-1" \
  psql -U radius -d radius -At -c "SELECT count(*) FROM radius_platform.agent_environment_revisions")"
[[ "${restored_revisions}" == "1" ]]
restored_installations="$(docker exec "${COMPOSE_PROJECT_NAME}-postgres-1" \
  psql -U radius -d radius -At -F '|' -c "
    SELECT
      (SELECT count(*) FROM radius_platform.physical_devices),
      (SELECT count(*) FROM radius_platform.client_installations),
      (SELECT count(*) FROM radius_platform.client_installation_observations),
      (SELECT count(*) FROM radius_platform.agent_installations),
      (SELECT count(*) FROM radius_platform.agent_installation_observations)")"
[[ "${restored_installations}" == "1|1|1|1|1" ]]
restored_outbox="$(docker exec "${COMPOSE_PROJECT_NAME}-postgres-1" \
  psql -U radius -d radius -At -c "SELECT count(*) FROM radius_platform.job_outbox_messages")"
[[ "${restored_outbox}" == "1" ]]
restored_migrations="$(docker exec "${COMPOSE_PROJECT_NAME}-postgres-1" \
  psql -U radius -d radius -At -c "SELECT count(*) FROM radius_migrations.__drizzle_migrations")"
[[ "${restored_migrations}" == "2" ]]
restored_membership_evidence="$(docker exec "${COMPOSE_PROJECT_NAME}-postgres-1" \
  psql -U radius -d radius -At -F '|' -c "
    SELECT membership.role_code, membership.lifecycle_state,
      (SELECT count(*) FROM radius_platform.audit_events
       WHERE action_code = 'organization_membership.update'),
      (SELECT count(*) FROM radius_platform.idempotency_records
       WHERE operation_code = 'organization_membership.update'),
      (SELECT count(*) FROM radius_platform.developer_tokens
       WHERE developer_token_id = '52000000-0000-4000-8000-000000000002'
         AND revoked_at IS NOT NULL),
      (SELECT count(*) FROM radius_platform.platform_sessions
       WHERE session_id = '51000000-0000-4000-8000-000000000002'
         AND revoked_at IS NOT NULL)
    FROM radius_platform.organization_memberships AS membership
    WHERE membership.membership_id = '50000000-0000-4000-8000-000000000002';
  ")"
[[ "${restored_membership_evidence}" == "developer|active|5|5|1|1" ]]
curl -fsSI \
  -u "${RADIUS_REGISTRY_USERNAME}:${RADIUS_REGISTRY_PASSWORD}" \
  -H "Accept: application/vnd.oci.image.manifest.v1+json" \
  "http://127.0.0.1:${SMOKE_REGISTRY_PORT}/v2/agent_example1/agent/manifests/${deployment_digest}" \
  | grep -qi "Docker-Content-Digest: ${deployment_digest}"
curl -fsS "http://127.0.0.1:${SMOKE_WEB_PORT}/login" | grep -q "Sign in to Radius"
restored_inventory="$(
  cd "${ROOT_DIR}/examples/typescript-agent"
  RADIUS_API_URL="http://127.0.0.1:${SMOKE_API_PORT}" \
    RADIUS_ACCESS_TOKEN="${access_token}" \
    node ../../packages/cli/dist/cli.js deployments list --json
)"
grep -q "${deployment_digest}" <<<"${restored_inventory}"

for service in ingress platform-api platform-jobs platform-web; do
  container_id="$("${compose[@]}" ps -q "${service}")"
  [[ "$(docker inspect "${container_id}" --format '{{.RestartCount}}')" == "0" ]]
done

echo "self-host verify: passed"
echo "  registry authentication: 401 anonymous, 200 authenticated"
echo "  TLS ingress: dashboard, Platform API, and registry routes verified"
echo "  organization access: role, suspend, remove, restore, and lockout invariants verified"
echo "  deployment digest: ${deployment_digest}"
echo "  installation reporting: physical device, client, and agent observations verified"
echo "  worker verification: completed"
echo "  paired backup/restore: recovered database and registry digest"
echo "  hardened services: read-only roots, zero restarts"
