#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 SHORT_NAME" >&2
  exit 64
fi

profile_name=$1
if [[ ! "$profile_name" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "profile name may contain only letters, numbers, dot, underscore, and hyphen" >&2
  exit 64
fi

source_root="${RADIUS_PROFILE_ROOT:-${HOME:?HOME is required}/Library/Application Support/Radius}"
profiles_root="$source_root/test-profiles"
target_root="$profiles_root/$profile_name"
stage_root="$profiles_root/.${profile_name}.tmp-$$"
database_path="$source_root/radius.db"
vault_path="$source_root/credential-vault.json"

if [[ ! -f "$database_path" || ! -f "$vault_path" ]]; then
  echo "the normal Radius database and credential vault must both exist" >&2
  exit 66
fi
if lsof -n "$database_path" >/dev/null 2>&1; then
  echo "Radius is using the normal database; quit every dev and packaged instance first" >&2
  exit 75
fi
if [[ -e "$target_root" ]]; then
  echo "test profile already exists: $target_root" >&2
  exit 73
fi

cleanup() {
  rm -rf "$stage_root"
}
trap cleanup EXIT

mkdir -p "$profiles_root" "$stage_root"
chmod 0700 "$profiles_root" "$stage_root"
for file_name in credential-vault.json radius.db radius.db-wal radius.db-shm; do
  if [[ -f "$source_root/$file_name" ]]; then
    cp -p "$source_root/$file_name" "$stage_root/$file_name"
    chmod 0600 "$stage_root/$file_name"
  fi
done
printf '%s\n' \
  "Source: $source_root" \
  "Created: $(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  > "$stage_root/PROFILE_SOURCE.txt"
chmod 0600 "$stage_root/PROFILE_SOURCE.txt"
mv "$stage_root" "$target_root"
trap - EXIT

echo "$target_root"
echo "RADIUS_USER_DATA_PATH='$target_root' bun run dev"
