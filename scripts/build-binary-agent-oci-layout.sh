#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 4 || $# -gt 5 ]]; then
  echo "usage: $0 BINARY OUTPUT_DIR IMAGE_REFERENCE VERSION [CA_BUNDLE]" >&2
  exit 64
fi

binary_path=$1
output_dir=$2
image_reference=$3
release_version=$4
ca_bundle=${5:-}

if [[ ! -f "$binary_path" || ! -x "$binary_path" ]]; then
  echo "binary must be an existing executable file" >&2
  exit 66
fi
if [[ -e "$output_dir" ]]; then
  echo "output directory already exists: $output_dir" >&2
  exit 73
fi
if [[ "$image_reference" != *:* ]]; then
  echo "image reference must include a tag" >&2
  exit 64
fi
if [[ -n "$ca_bundle" && ! -f "$ca_bundle" ]]; then
  echo "CA bundle must be an existing file" >&2
  exit 66
fi

stage_dir=$(mktemp -d)
cleanup() {
  rm -rf "$stage_dir"
}
trap cleanup EXIT

rootfs_dir="$stage_dir/rootfs"
layout_dir="$stage_dir/layout"
blob_dir="$layout_dir/blobs/sha256"
mkdir -p \
  "$rootfs_dir/usr/local/bin" \
  "$rootfs_dir/opt/data" \
  "$rootfs_dir/etc/ssl/certs" \
  "$blob_dir"
cp "$binary_path" "$rootfs_dir/usr/local/bin/agent"
if [[ -n "$ca_bundle" ]]; then
  cp "$ca_bundle" "$rootfs_dir/etc/ssl/certs/ca-certificates.crt"
  chmod 0644 "$rootfs_dir/etc/ssl/certs/ca-certificates.crt"
fi
chmod 0755 "$rootfs_dir/usr/local/bin/agent"
chmod 0700 "$rootfs_dir/opt/data"
find "$rootfs_dir" -exec touch -h -t 197001010000 {} +

layer_tar="$stage_dir/layer.tar"
COPYFILE_DISABLE=1 tar \
  --format pax \
  --no-xattrs \
  --uid 10000 \
  --gid 10000 \
  --uname radius \
  --gname radius \
  -C "$rootfs_dir" \
  -cf "$layer_tar" .
layer_diff_id=$(shasum -a 256 "$layer_tar" | awk '{print $1}')
gzip -n -9 "$layer_tar"
layer_blob="$layer_tar.gz"
layer_digest=$(shasum -a 256 "$layer_blob" | awk '{print $1}')
layer_size=$(stat -f '%z' "$layer_blob")
mv "$layer_blob" "$blob_dir/$layer_digest"

binary_digest=$(shasum -a 256 "$binary_path" | awk '{print $1}')
config_json="$stage_dir/config.json"
jq -cn \
  --arg version "$release_version" \
  --arg binary_digest "$binary_digest" \
  --arg diff_id "sha256:$layer_diff_id" \
  '{
    architecture: "arm64",
    os: "linux",
    created: "1970-01-01T00:00:00Z",
    config: {
      User: "10000:10000",
      Env: ["HOME=/opt/data", "PATH=/usr/local/bin:/usr/bin:/bin"],
      Entrypoint: ["/usr/local/bin/agent", "acp"],
      WorkingDir: "/opt/data",
      Labels: {
        "org.opencontainers.image.version": $version,
        "ai.curve.radius.source-binary-sha256": $binary_digest
      }
    },
    rootfs: {type: "layers", diff_ids: [$diff_id]},
    history: [{created: "1970-01-01T00:00:00Z", created_by: "Radius verified binary release"}]
  }' > "$config_json"
config_digest=$(shasum -a 256 "$config_json" | awk '{print $1}')
config_size=$(stat -f '%z' "$config_json")
mv "$config_json" "$blob_dir/$config_digest"

manifest_json="$stage_dir/manifest.json"
jq -cn \
  --arg config_digest "sha256:$config_digest" \
  --argjson config_size "$config_size" \
  --arg layer_digest "sha256:$layer_digest" \
  --argjson layer_size "$layer_size" \
  '{
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: {
      mediaType: "application/vnd.oci.image.config.v1+json",
      digest: $config_digest,
      size: $config_size
    },
    layers: [{
      mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
      digest: $layer_digest,
      size: $layer_size
    }]
  }' > "$manifest_json"
manifest_digest=$(shasum -a 256 "$manifest_json" | awk '{print $1}')
manifest_size=$(stat -f '%z' "$manifest_json")
mv "$manifest_json" "$blob_dir/$manifest_digest"

jq -cn \
  --arg reference "$image_reference" \
  --arg digest "sha256:$manifest_digest" \
  --argjson size "$manifest_size" \
  '{
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [{
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      digest: $digest,
      size: $size,
      platform: {architecture: "arm64", os: "linux"},
      annotations: {
        "io.containerd.image.name": $reference,
        "org.opencontainers.image.ref.name": ($reference | split(":")[-1])
      }
    }]
  }' > "$layout_dir/index.json"
jq -cn '{imageLayoutVersion: "1.0.0"}' > "$layout_dir/oci-layout"

mkdir -p "$(dirname "$output_dir")"
mv "$layout_dir" "$output_dir"
echo "sha256:$manifest_digest"
