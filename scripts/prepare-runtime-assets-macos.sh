#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
manifest_path="$repo_root/apps/runtime-host-macos/Config/runtime-assets.json"
asset_root="$repo_root/apps/runtime-host-macos/.build/runtime-assets"
cache_root="$asset_root/cache"
kernel_archive="$cache_root/kernel.tar.zst"
kernel_output="$asset_root/vmlinux-arm64"

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "The bundled Radius runtime assets currently target Apple Silicon macOS." >&2
  exit 69
fi

manifest_value() {
  node -e '
    const manifest = require(process.argv[1]);
    const value = process.argv[2].split(".").reduce((current, key) => current[key], manifest);
    if (typeof value !== "string" || value.length === 0) process.exit(65);
    process.stdout.write(value);
  ' "$manifest_path" "$1"
}

kernel_url=$(manifest_value kernel.archiveUrl)
kernel_sha256=$(manifest_value kernel.archiveSha256)
kernel_member=$(manifest_value kernel.binaryPath)

mkdir -p "$cache_root"

archive_is_valid=false
if [ -f "$kernel_archive" ]; then
  actual_sha256=$(shasum -a 256 "$kernel_archive" | awk '{print $1}')
  if [ "$actual_sha256" = "$kernel_sha256" ]; then
    archive_is_valid=true
  fi
fi

if [ "$archive_is_valid" != "true" ]; then
  partial_archive="$kernel_archive.partial"
  curl --fail --location --retry 3 --output "$partial_archive" "$kernel_url"
  actual_sha256=$(shasum -a 256 "$partial_archive" | awk '{print $1}')
  if [ "$actual_sha256" != "$kernel_sha256" ]; then
    echo "Kernel archive digest mismatch: expected $kernel_sha256, got $actual_sha256" >&2
    exit 65
  fi
  mv "$partial_archive" "$kernel_archive"
fi

runtime_temp_dir=$(mktemp -d /tmp/radius-runtime-assets.XXXXXX)
trap 'rm -rf "$runtime_temp_dir"' EXIT INT TERM
tar -xf "$kernel_archive" -C "$runtime_temp_dir" "$kernel_member"
install -m 0644 "$runtime_temp_dir/$kernel_member" "$kernel_output"

if [ ! -s "$kernel_output" ]; then
  echo "Prepared kernel is empty: $kernel_output" >&2
  exit 65
fi

echo "$kernel_output"
