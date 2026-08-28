#!/usr/bin/env bash
set -euo pipefail

repository_root=$(cd "$(dirname "$0")/.." && pwd)
output_root="$repository_root/apps/runtime-host-macos/.build/provider-assets"

rm -rf "$output_root"
mkdir -p "$output_root"

bash "$repository_root/scripts/prepare-fx-agent-macos.sh"
cp \
  "$repository_root/apps/runtime-host-macos/Config/bundled-agents.json" \
  "$output_root/index.json"

echo "$output_root"
