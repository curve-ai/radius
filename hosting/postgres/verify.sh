#!/usr/bin/env bash
set -euo pipefail

readonly expected_version="postgres (PostgreSQL) 17.11 (Debian 17.11-1.pgdg12+2)"
readonly image="${1:-radius-postgres:dev}"

actual_version="$(docker run --rm "$image" postgres --version)"
if [[ "$actual_version" != "$expected_version" ]]; then
  echo "Expected $expected_version, received $actual_version" >&2
  exit 1
fi

echo "Verified $image: $actual_version"
