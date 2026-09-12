#!/usr/bin/env bash
set -euo pipefail

fx_version="0.0.9"
mac_archive="fx-macos-aarch64.tar.gz"
linux_archive="fx-linux-aarch64.tar.gz"
mac_sha256="45fe7b05238b8e5ae7b2c2caeab86218af9bd016e99b8c2b4b363baaa4cab7ee"
linux_sha256="741eb64e832d168309025fb9e84a0ccb1b842043d796f18898ed06c65d83a498"
ca_bundle_sha256="f66dff1bdf8f96060b8177976f8b7d9254bc89bc4db933d769f7384d28480bc9"
release_base="https://github.com/vercel-labs/fx/releases/download/v${fx_version}"

repository_root=$(cd "$(dirname "$0")/.." && pwd)
output_root="$repository_root/apps/runtime-host-macos/.build/provider-assets/fx"
release_template="$repository_root/apps/runtime-host-macos/Config/fx-release-template.json"
radius_release_version=$(jq -er '.releaseVersion' "$release_template")
image_reference=$(jq -er '.image.reference' "$release_template")
stage_dir=$(mktemp -d)
cleanup() {
  rm -rf "$stage_dir"
}
trap cleanup EXIT

download_and_verify() {
  local archive_name=$1
  local expected_sha256=$2
  curl -fsSL "$release_base/$archive_name" -o "$stage_dir/$archive_name"
  local actual_sha256
  actual_sha256=$(shasum -a 256 "$stage_dir/$archive_name" | awk '{print $1}')
  if [[ "$actual_sha256" != "$expected_sha256" ]]; then
    echo "fx checksum mismatch for $archive_name" >&2
    exit 65
  fi
}

download_and_verify "$mac_archive" "$mac_sha256"
download_and_verify "$linux_archive" "$linux_sha256"
curl -fsSL https://curl.se/ca/cacert.pem -o "$stage_dir/cacert.pem"
actual_ca_bundle_sha256=$(shasum -a 256 "$stage_dir/cacert.pem" | awk '{print $1}')
if [[ "$actual_ca_bundle_sha256" != "$ca_bundle_sha256" ]]; then
  echo "CA bundle checksum mismatch" >&2
  exit 65
fi

mkdir -p "$stage_dir/mac" "$stage_dir/linux"
tar -xzf "$stage_dir/$mac_archive" -C "$stage_dir/mac"
tar -xzf "$stage_dir/$linux_archive" -C "$stage_dir/linux"
if [[ ! -x "$stage_dir/mac/fx" || ! -x "$stage_dir/linux/fx" ]]; then
  echo "fx release archives did not contain executable binaries" >&2
  exit 66
fi

prepared_root="$stage_dir/prepared"
mkdir -p "$prepared_root/macos-arm64" "$prepared_root/notices"
cp "$stage_dir/mac/fx" "$prepared_root/macos-arm64/fx"
chmod 0755 "$prepared_root/macos-arm64/fx"
for notice in LICENSE THIRD_PARTY_NOTICES.md; do
  if [[ -f "$stage_dir/mac/$notice" ]]; then
    cp "$stage_dir/mac/$notice" "$prepared_root/notices/$notice"
  fi
done

"$repository_root/scripts/build-binary-agent-oci-layout.sh" \
  "$stage_dir/linux/fx" \
  "$prepared_root/oci-layout" \
  "$image_reference" \
  "$radius_release_version" \
  "$stage_dir/cacert.pem" \
  "$release_template" >/dev/null
printf '%s\n' \
  "Source: https://curl.se/ca/cacert.pem" \
  "SHA-256: $ca_bundle_sha256" \
  > "$prepared_root/notices/CA_BUNDLE_SOURCE.txt"

mkdir -p "$(dirname "$output_root")"
rm -rf "$output_root"
mv "$prepared_root" "$output_root"

"$output_root/macos-arm64/fx" --version
echo "$output_root"
