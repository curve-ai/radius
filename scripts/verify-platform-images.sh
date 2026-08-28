#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  local status=$?
  rm -rf -- "${TMP_DIR}"
  exit "${status}"
}
trap cleanup EXIT

for command in docker jq tar; do
  command -v "${command}" >/dev/null || {
    echo "platform image verify: ${command} is required" >&2
    exit 1
  }
done

images=(
  "radius-platform-api|apps/platform-api/Dockerfile|bun|true"
  "radius-platform-jobs|apps/platform-jobs/Dockerfile|bun|true"
  "radius-platform-web|apps/platform-web/Dockerfile|radius|true"
  "radius-postgres|hosting/postgres/Containerfile||false"
)

for entry in "${images[@]}"; do
  IFS='|' read -r image dockerfile expected_user require_healthcheck <<<"${entry}"
  archive="${TMP_DIR}/${image}.tar"
  docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --provenance=false \
    --sbom=false \
    --file "${ROOT_DIR}/${dockerfile}" \
    --output "type=oci,dest=${archive}" \
    "${ROOT_DIR}" >/dev/null

  index_digest="$(
    tar -xOf "${archive}" index.json \
      | jq -er '
          if (.manifests | length) != 1 then error("expected one root index") else . end
          | .manifests[0]
          | select(.mediaType == "application/vnd.oci.image.index.v1+json")
          | .digest
        '
  )"
  index_blob="blobs/sha256/${index_digest#sha256:}"
  platform_index="$(tar -xOf "${archive}" "${index_blob}")"

  [[ "$(jq -r '.manifests | length' <<<"${platform_index}")" == "2" ]]
  [[ "$(jq -r '[.manifests[].platform | (.os + "/" + .architecture)] | sort | join(",")' <<<"${platform_index}")" == "linux/amd64,linux/arm64" ]]

  while read -r manifest_digest; do
    manifest_blob="blobs/sha256/${manifest_digest#sha256:}"
    config_digest="$(
      tar -xOf "${archive}" "${manifest_blob}" | jq -er '.config.digest'
    )"
    config_blob="blobs/sha256/${config_digest#sha256:}"
    config="$(tar -xOf "${archive}" "${config_blob}")"
    [[ "$(jq -r '.config.Labels["org.opencontainers.image.licenses"]' <<<"${config}")" == "MIT" ]]
    [[ "$(jq -r '.config.Labels["org.opencontainers.image.source"]' <<<"${config}")" == "https://github.com/curve-ai/radius" ]]
    if [[ "${require_healthcheck}" == "true" ]]; then
      [[ "$(jq -r '.config.Healthcheck.Test[0]' <<<"${config}")" == "CMD-SHELL" ]]
    fi
    if [[ -n "${expected_user}" ]]; then
      [[ "$(jq -r '.config.User' <<<"${config}")" == "${expected_user}" ]]
    fi
  done < <(jq -r '.manifests[].digest' <<<"${platform_index}")

  echo "platform image verify: ${image} ${index_digest} linux/amd64,linux/arm64"
done

echo "platform image verify: passed"
