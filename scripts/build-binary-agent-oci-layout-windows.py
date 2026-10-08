#!/usr/bin/env python3
"""One-layer OCI layout around a Linux amd64 binary; tarfile is used because it can force mode 0755."""

import base64
import gzip
import hashlib
import io
import json
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path

EPOCH = 0


def fail(message: str, code: int = 1) -> "NoReturn":  # type: ignore[name-defined]
    print(message, file=sys.stderr)
    raise SystemExit(code)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def add_file(tar: tarfile.TarFile, arcname: str, source: Path, mode: int) -> None:
    info = tarfile.TarInfo(name=arcname)
    info.size = source.stat().st_size
    info.mode = mode
    info.uid = 10000
    info.gid = 10000
    info.uname = "radius"
    info.gname = "radius"
    info.mtime = EPOCH
    with source.open("rb") as handle:
        tar.addfile(info, handle)


def add_dir(tar: tarfile.TarFile, arcname: str, mode: int) -> None:
    info = tarfile.TarInfo(name=arcname)
    info.type = tarfile.DIRTYPE
    info.mode = mode
    info.uid = 10000
    info.gid = 10000
    info.uname = "radius"
    info.gname = "radius"
    info.mtime = EPOCH
    tar.addfile(info)


def main() -> None:
    args = sys.argv[1:]
    if not 4 <= len(args) <= 6:
        fail(f"usage: {sys.argv[0]} BINARY OUTPUT_DIR IMAGE_REFERENCE VERSION [CA_BUNDLE] [RELEASE_TEMPLATE]", 64)
    binary_path = Path(args[0])
    output_dir = Path(args[1])
    image_reference = args[2]
    release_version = args[3]
    ca_bundle = Path(args[4]) if len(args) > 4 and args[4] else None
    release_template = Path(args[5]) if len(args) > 5 and args[5] else None

    if not binary_path.is_file():
        fail("binary must be an existing file", 66)
    if output_dir.exists():
        fail(f"output directory already exists: {output_dir}", 73)
    if ":" not in image_reference:
        fail("image reference must include a tag", 64)
    if ca_bundle is not None and not ca_bundle.is_file():
        fail("CA bundle must be an existing file", 66)
    if release_template is not None and not release_template.is_file():
        fail("release template must be an existing file", 66)

    with tempfile.TemporaryDirectory(prefix="radius-fx-oci-") as stage_name:
        stage_dir = Path(stage_name)
        blob_dir = stage_dir / "layout" / "blobs" / "sha256"
        blob_dir.mkdir(parents=True)

        layer_tar_path = stage_dir / "layer.tar"
        with tarfile.open(layer_tar_path, "w", format=tarfile.USTAR_FORMAT) as tar:
            add_dir(tar, "usr", 0o755)
            add_dir(tar, "usr/local", 0o755)
            add_dir(tar, "usr/local/bin", 0o755)
            add_file(tar, "usr/local/bin/agent", binary_path, 0o755)
            add_dir(tar, "opt", 0o755)
            add_dir(tar, "opt/data", 0o700)
            if ca_bundle is not None:
                add_dir(tar, "etc", 0o755)
                add_dir(tar, "etc/ssl", 0o755)
                add_dir(tar, "etc/ssl/certs", 0o755)
                add_file(tar, "etc/ssl/certs/ca-certificates.crt", ca_bundle, 0o644)

        with tarfile.open(layer_tar_path) as check:
            if "usr/local/bin/agent" not in check.getnames():
                fail("layer archive does not contain usr/local/bin/agent", 70)

        layer_diff_id = sha256_file(layer_tar_path)
        layer_blob_path = stage_dir / "layer.tar.gz"
        with layer_tar_path.open("rb") as raw, layer_blob_path.open("wb") as blob:
            with gzip.GzipFile(filename="", mode="wb", fileobj=blob, mtime=EPOCH, compresslevel=9) as gz:
                shutil.copyfileobj(raw, gz)
        layer_digest = sha256_file(layer_blob_path)
        layer_size = layer_blob_path.stat().st_size
        shutil.move(str(layer_blob_path), blob_dir / layer_digest)

        binary_digest = sha256_file(binary_path)
        release_template_base64 = ""
        if release_template is not None:
            canonical = json.dumps(
                json.loads(release_template.read_text("utf-8")),
                separators=(",", ":"),
                sort_keys=True,
            )
            release_template_base64 = base64.b64encode(canonical.encode("utf-8")).decode("ascii")

        labels = {
            "org.opencontainers.image.version": release_version,
            "ai.curve.radius.source-binary-sha256": binary_digest,
        }
        if release_template_base64:
            labels["ai.curve.radius.release-template.v1"] = release_template_base64

        config = {
            "architecture": "amd64",
            "os": "linux",
            "created": "1970-01-01T00:00:00Z",
            "config": {
                "User": "10000:10000",
                "Env": ["HOME=/opt/data", "PATH=/usr/local/bin:/usr/bin:/bin"],
                "Entrypoint": ["/usr/local/bin/agent", "acp"],
                "WorkingDir": "/opt/data",
                "Labels": labels,
            },
            "rootfs": {"type": "layers", "diff_ids": [f"sha256:{layer_diff_id}"]},
            "history": [
                {"created": "1970-01-01T00:00:00Z", "created_by": "Radius verified binary release"}
            ],
        }
        config_bytes = json.dumps(config, separators=(",", ":")).encode("utf-8")
        config_digest = sha256_bytes(config_bytes)
        (blob_dir / config_digest).write_bytes(config_bytes)

        manifest = {
            "schemaVersion": 2,
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "config": {
                "mediaType": "application/vnd.oci.image.config.v1+json",
                "digest": f"sha256:{config_digest}",
                "size": len(config_bytes),
            },
            "layers": [
                {
                    "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
                    "digest": f"sha256:{layer_digest}",
                    "size": layer_size,
                }
            ],
        }
        manifest_bytes = json.dumps(manifest, separators=(",", ":")).encode("utf-8")
        manifest_digest = sha256_bytes(manifest_bytes)
        (blob_dir / manifest_digest).write_bytes(manifest_bytes)

        index = {
            "schemaVersion": 2,
            "mediaType": "application/vnd.oci.image.index.v1+json",
            "manifests": [
                {
                    "mediaType": "application/vnd.oci.image.manifest.v1+json",
                    "digest": f"sha256:{manifest_digest}",
                    "size": len(manifest_bytes),
                    "platform": {"architecture": "amd64", "os": "linux"},
                    "annotations": {
                        "io.containerd.image.name": image_reference,
                        "org.opencontainers.image.ref.name": image_reference.rsplit(":", 1)[-1],
                    },
                }
            ],
        }
        (stage_dir / "layout" / "index.json").write_text(
            json.dumps(index, separators=(",", ":")), encoding="utf-8"
        )
        (stage_dir / "layout" / "oci-layout").write_text(
            json.dumps({"imageLayoutVersion": "1.0.0"}), encoding="utf-8"
        )

        output_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(stage_dir / "layout"), output_dir)

    print(f"sha256:{manifest_digest}")


if __name__ == "__main__":
    main()
