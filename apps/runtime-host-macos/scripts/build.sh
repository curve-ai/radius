#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package_path="$repo_root/apps/runtime-host-macos"
entitlements_path="$package_path/Config/RadiusRuntimeHost.entitlements"
codesign_identity=${RADIUS_RUNTIME_CODESIGN_IDENTITY:--}
# Notarization rejects a Developer ID signature without a secure timestamp;
# an ad-hoc signature cannot carry one.
codesign_timestamp=--timestamp=none
if [ "$codesign_identity" != "-" ]; then
  codesign_timestamp=--timestamp
fi

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "The bundled Radius runtime host currently builds only on Apple Silicon macOS." >&2
  exit 69
fi

swift build --package-path "$package_path" --configuration release
binary_dir=$(swift build --package-path "$package_path" --configuration release --show-bin-path)
binary_path="$binary_dir/radius-runtime-host"

codesign \
  --force \
  --sign "$codesign_identity" \
  "$codesign_timestamp" \
  --options runtime \
  --entitlements "$entitlements_path" \
  "$binary_path"

codesign --verify --strict --verbose=2 "$binary_path"

# Hosted CI Macs are virtual machines without nested virtualization, where
# doctor rightly exits 69. It must still start, which proves the signed binary
# links and loads.
doctor_status=0
"$binary_path" doctor --json || doctor_status=$?
if [ "$doctor_status" -eq 69 ] && [ "${RADIUS_RUNTIME_ALLOW_UNSUPPORTED_HOST:-}" = "1" ]; then
  echo "This Mac cannot run agents; continuing because RADIUS_RUNTIME_ALLOW_UNSUPPORTED_HOST=1." >&2
elif [ "$doctor_status" -ne 0 ]; then
  exit "$doctor_status"
fi
