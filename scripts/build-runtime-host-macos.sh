#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
package_path="$repo_root/apps/runtime-host-macos"
entitlements_path="$package_path/Config/RadiusRuntimeHost.entitlements"
codesign_identity=${RADIUS_RUNTIME_CODESIGN_IDENTITY:--}

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
  --timestamp=none \
  --options runtime \
  --entitlements "$entitlements_path" \
  "$binary_path"

codesign --verify --strict --verbose=2 "$binary_path"
"$binary_path" doctor --json
