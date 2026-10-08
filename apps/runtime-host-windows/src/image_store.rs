use std::collections::BTreeMap;
use std::ffi::c_void;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::command::LoadImageOptions;
use crate::error::{RuntimeHostError, runtime};

const OCI_INDEX: &str = "application/vnd.oci.image.index.v1+json";
const OCI_MANIFEST: &str = "application/vnd.oci.image.manifest.v1+json";
const DOCKER_MANIFEST_LIST: &str = "application/vnd.docker.distribution.manifest.list.v2+json";
const DOCKER_MANIFEST: &str = "application/vnd.docker.distribution.manifest.v2+json";

const REFERENCE_ANNOTATIONS: [&str; 3] = [
    "com.apple.containerization.image.name",
    "io.containerd.image.name",
    "org.opencontainers.image.ref.name",
];

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoadedImageReport {
    pub images: Vec<LoadedImage>,
    pub protocol_version: u32,
    #[serde(rename = "type")]
    pub kind: &'static str,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct LoadedImage {
    pub digest: String,
    pub reference: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Descriptor {
    #[serde(default)]
    media_type: String,
    digest: String,
    size: u64,
    #[serde(default)]
    annotations: BTreeMap<String, String>,
    #[serde(default)]
    platform: Option<Platform>,
}

#[derive(Deserialize)]
struct Platform {
    architecture: String,
    os: String,
}

#[derive(Deserialize)]
struct Index {
    manifests: Vec<Descriptor>,
}

#[derive(Deserialize)]
struct Manifest {
    config: Descriptor,
    #[serde(default)]
    layers: Vec<Descriptor>,
}

pub struct ImageLayer {
    pub media_type: String,
    pub path: PathBuf,
}

pub struct ImageProcess {
    pub arguments: Vec<String>,
    pub environment: Vec<String>,
    pub working_directory: Option<String>,
}

pub struct ResolvedImage {
    pub manifest_digest: String,
    pub layers: Vec<ImageLayer>,
    pub process: ImageProcess,
}

#[derive(Deserialize)]
struct ImageConfig {
    #[serde(default)]
    os: String,
    #[serde(default)]
    architecture: String,
    #[serde(default)]
    config: Option<ProcessConfig>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
struct ProcessConfig {
    entrypoint: Option<Vec<String>>,
    cmd: Option<Vec<String>>,
    env: Option<Vec<String>>,
    working_dir: Option<String>,
}

pub fn resolve(root: &Path, reference: &str) -> Result<ResolvedImage, RuntimeHostError> {
    let references_path = root.join("images.json");
    let references: BTreeMap<String, String> = if references_path.exists() {
        read_json(&references_path)?
    } else {
        BTreeMap::new()
    };
    let found = references.get(reference).cloned().or_else(|| {
        let (name, hex) = reference.split_once("@sha256:")?;
        references
            .get(name)
            .filter(|digest| digest.strip_prefix("sha256:") == Some(hex))
            .cloned()
    });
    let Some(mut digest) = found else {
        return Err(runtime(if reference.starts_with("radius.local/") {
            format!("Local agent image is not loaded in the selected runtime store: {reference}")
        } else {
            format!(
                "Image {reference} is not loaded. Pulling from a registry is not supported on Windows yet."
            )
        }));
    };

    let blob = |digest: &str| -> Result<PathBuf, RuntimeHostError> {
        Ok(root.join("blobs").join("sha256").join(sha256_hex(digest)?))
    };
    let mut document: serde_json::Value = read_json(&blob(&digest)?)?;
    if document.get("manifests").is_some() {
        let index: Index = serde_json::from_value(document)
            .map_err(|error| runtime(format!("Invalid image index {digest}: {error}")))?;
        digest = index
            .manifests
            .into_iter()
            .find(|manifest| {
                manifest.platform.as_ref().is_some_and(|platform| {
                    platform.os == "linux" && platform.architecture == "amd64"
                })
            })
            .ok_or_else(|| runtime(format!("Image {reference} has no linux/amd64 variant")))?
            .digest;
        document = read_json(&blob(&digest)?)?;
    }
    let manifest: Manifest = serde_json::from_value(document)
        .map_err(|error| runtime(format!("Invalid image manifest {digest}: {error}")))?;

    let config: ImageConfig = read_json(&blob(&manifest.config.digest)?)?;
    if config.os != "linux" || config.architecture != "amd64" {
        return Err(runtime(format!(
            "Image {reference} is built for {}/{}, but this computer runs linux/amd64 images",
            config.os, config.architecture
        )));
    }
    let process = config.config.unwrap_or_default();

    let layers = manifest
        .layers
        .iter()
        .map(|layer| {
            Ok(ImageLayer {
                media_type: layer.media_type.clone(),
                path: blob(&layer.digest)?,
            })
        })
        .collect::<Result<_, RuntimeHostError>>()?;
    Ok(ResolvedImage {
        manifest_digest: digest,
        layers,
        process: ImageProcess {
            arguments: process
                .entrypoint
                .unwrap_or_default()
                .into_iter()
                .chain(process.cmd.unwrap_or_default())
                .collect(),
            environment: process.env.unwrap_or_default(),
            working_directory: process
                .working_dir
                .filter(|directory| !directory.is_empty()),
        },
    })
}

// Known limit: no lock around images.json; add one if two load-image runs overlap.
pub fn load(options: &LoadImageOptions) -> Result<LoadedImageReport, RuntimeHostError> {
    let layout = Path::new(&options.layout_path);
    if !layout.exists() {
        return Err(RuntimeHostError::InvalidArguments(format!(
            "OCI layout does not exist at {}",
            layout.display()
        )));
    }
    let root = Path::new(&options.root_path);
    let blobs = root.join("blobs").join("sha256");
    fs::create_dir_all(&blobs)
        .map_err(|error| runtime(format!("Could not create {}: {error}", blobs.display())))?;

    let marker: serde_json::Value = read_json(&layout.join("oci-layout"))?;
    if marker.get("imageLayoutVersion").is_none() {
        return Err(runtime(format!(
            "{} is not an OCI image layout: oci-layout has no imageLayoutVersion",
            layout.display()
        )));
    }
    let index: Index = read_json(&layout.join("index.json"))?;
    if index.manifests.is_empty() {
        return Err(runtime("OCI layout index.json lists no images"));
    }

    let references_path = root.join("images.json");
    let mut references: BTreeMap<String, String> = if references_path.exists() {
        read_json(&references_path)?
    } else {
        BTreeMap::new()
    };
    let mut images = Vec::new();
    for descriptor in &index.manifests {
        import(layout, root, descriptor)?;
        let reference = REFERENCE_ANNOTATIONS
            .iter()
            .find_map(|key| descriptor.annotations.get(*key))
            .cloned()
            .unwrap_or_else(|| format!("untagged@{}", descriptor.digest));
        references.insert(reference.clone(), descriptor.digest.clone());
        images.push(LoadedImage {
            digest: descriptor.digest.clone(),
            reference,
        });
    }

    let partial = root.join("images.json.partial");
    let json = serde_json::to_vec_pretty(&references).expect("a string map serializes");
    fs::write(&partial, json)
        .and_then(|()| fs::rename(&partial, &references_path))
        .map_err(|error| {
            runtime(format!(
                "Could not write {}: {error}",
                references_path.display()
            ))
        })?;

    Ok(LoadedImageReport {
        images,
        protocol_version: 1,
        kind: "radius.runtime.images-loaded",
    })
}

fn import(layout: &Path, root: &Path, descriptor: &Descriptor) -> Result<(), RuntimeHostError> {
    let stored = store_blob(layout, root, descriptor)?;
    match descriptor.media_type.as_str() {
        OCI_INDEX | DOCKER_MANIFEST_LIST => {
            let index: Index = read_json(&stored)?;
            for child in &index.manifests {
                import(layout, root, child)?;
            }
        }
        OCI_MANIFEST | DOCKER_MANIFEST => {
            let manifest: Manifest = read_json(&stored)?;
            store_blob(layout, root, &manifest.config)?;
            for layer in &manifest.layers {
                store_blob(layout, root, layer)?;
            }
        }
        other => {
            return Err(runtime(format!(
                "Unsupported OCI media type '{other}' for {}",
                descriptor.digest
            )));
        }
    }
    Ok(())
}

fn store_blob(
    layout: &Path,
    root: &Path,
    descriptor: &Descriptor,
) -> Result<PathBuf, RuntimeHostError> {
    let hex = sha256_hex(&descriptor.digest)?;
    let target = root.join("blobs").join("sha256").join(hex);
    if target.is_file() {
        return Ok(target);
    }

    let source = layout.join("blobs").join("sha256").join(hex);
    let failed = |error: std::io::Error| {
        runtime(format!(
            "Could not import blob {}: {error}",
            descriptor.digest
        ))
    };
    let mut input = File::open(&source).map_err(failed)?;
    let partial = target.with_extension("partial");
    let mut output = File::create(&partial).map_err(failed)?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    let mut size: u64 = 0;
    loop {
        let read = input.read(&mut buffer).map_err(failed)?;
        if read == 0 {
            break;
        }
        size += read as u64;
        hash.update(&buffer[..read]);
        output.write_all(&buffer[..read]).map_err(failed)?;
    }
    drop(output);

    let actual = hash.finish();
    if size != descriptor.size || actual != hex {
        let _ = fs::remove_file(&partial);
        return Err(runtime(format!(
            "Blob {} does not match its descriptor: expected {} bytes, found {size} bytes with sha256:{actual}",
            descriptor.digest, descriptor.size
        )));
    }
    fs::rename(&partial, &target).map_err(failed)?;
    Ok(target)
}

fn sha256_hex(digest: &str) -> Result<&str, RuntimeHostError> {
    match digest.strip_prefix("sha256:") {
        Some(hex)
            if hex.len() == 64
                && hex
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) =>
        {
            Ok(hex)
        }
        _ => Err(runtime(format!(
            "Unsupported blob digest '{digest}': only sha256 digests are accepted"
        ))),
    }
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, RuntimeHostError> {
    let bytes = fs::read(path)
        .map_err(|error| runtime(format!("Could not read {}: {error}", path.display())))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| runtime(format!("Invalid JSON in {}: {error}", path.display())))
}

struct Sha256(*mut c_void);

#[link(name = "bcrypt")]
unsafe extern "system" {
    fn BCryptCreateHash(
        algorithm: *mut c_void,
        hash: *mut *mut c_void,
        hash_object: *mut u8,
        hash_object_length: u32,
        secret: *const u8,
        secret_length: u32,
        flags: u32,
    ) -> i32;
    fn BCryptHashData(hash: *mut c_void, input: *const u8, input_length: u32, flags: u32) -> i32;
    fn BCryptFinishHash(hash: *mut c_void, output: *mut u8, output_length: u32, flags: u32) -> i32;
    fn BCryptDestroyHash(hash: *mut c_void) -> i32;
}

const BCRYPT_SHA256_ALG_HANDLE: *mut c_void = std::ptr::without_provenance_mut(0x41);

impl Sha256 {
    fn new() -> Self {
        let mut handle = std::ptr::null_mut();
        // SAFETY: a null hash-object buffer with length 0 asks CNG to allocate it; there is no secret.
        let status = unsafe {
            BCryptCreateHash(
                BCRYPT_SHA256_ALG_HANDLE,
                &mut handle,
                std::ptr::null_mut(),
                0,
                std::ptr::null(),
                0,
                0,
            )
        };
        assert!(
            status >= 0,
            "BCryptCreateHash failed with NTSTATUS {status:#010x}"
        );
        Self(handle)
    }

    fn update(&mut self, data: &[u8]) {
        let length = u32::try_from(data.len()).expect("hash chunk fits in u32");
        // SAFETY: `self.0` is a live hash handle and `data` is valid for reads of `length` bytes.
        let status = unsafe { BCryptHashData(self.0, data.as_ptr(), length, 0) };
        assert!(
            status >= 0,
            "BCryptHashData failed with NTSTATUS {status:#010x}"
        );
    }

    fn finish(self) -> String {
        let mut digest = [0u8; 32];
        // SAFETY: `self.0` is a live hash handle and `digest` has room for the 32-byte SHA-256 output.
        let status = unsafe { BCryptFinishHash(self.0, digest.as_mut_ptr(), 32, 0) };
        assert!(
            status >= 0,
            "BCryptFinishHash failed with NTSTATUS {status:#010x}"
        );
        digest.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}

impl Drop for Sha256 {
    fn drop(&mut self) {
        // SAFETY: `self.0` came from BCryptCreateHash and is destroyed exactly once.
        unsafe { BCryptDestroyHash(self.0) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest_of(bytes: &[u8]) -> String {
        let mut hash = Sha256::new();
        hash.update(bytes);
        format!("sha256:{}", hash.finish())
    }

    fn blob(layout: &Path, media_type: &str, bytes: &[u8]) -> (String, String) {
        let digest = digest_of(bytes);
        fs::write(
            layout.join("blobs").join("sha256").join(&digest[7..]),
            bytes,
        )
        .unwrap();
        let json = format!(
            r#"{{"mediaType":"{media_type}","digest":"{digest}","size":{}}}"#,
            bytes.len()
        );
        (digest, json)
    }

    #[test]
    fn sha256_and_digest_rules() {
        assert_eq!(
            digest_of(b"abc"),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let hex = "a".repeat(64);
        assert_eq!(sha256_hex(&format!("sha256:{hex}")).unwrap(), hex);
        assert!(sha256_hex("sha256:../../../../Windows/evil").is_err());
        assert!(sha256_hex(&format!("sha512:{hex}")).is_err());
        assert!(sha256_hex(&format!("sha256:{}", "A".repeat(64))).is_err());
    }

    #[test]
    fn loads_layout_and_rejects_tampered_blob() {
        let dir = std::env::temp_dir().join(format!(
            "radius-image-store-{}",
            crate::random::random_uuid()
        ));
        let layout = dir.join("layout");
        fs::create_dir_all(layout.join("blobs").join("sha256")).unwrap();

        let (_, config) = blob(
            &layout,
            "application/vnd.oci.image.config.v1+json",
            br#"{"os":"linux","architecture":"amd64"}"#,
        );
        let (layer_digest, layer) = blob(
            &layout,
            "application/vnd.oci.image.layer.v1.tar",
            b"layer bytes",
        );
        let manifest_json =
            format!(r#"{{"schemaVersion":2,"config":{config},"layers":[{layer}]}}"#);
        let (manifest_digest, manifest) = blob(&layout, OCI_MANIFEST, manifest_json.as_bytes());
        let named = manifest.replacen(
            '{',
            r#"{"annotations":{"io.containerd.image.name":"radius.local/dev/echo:1","org.opencontainers.image.ref.name":"1"},"#,
            1,
        );
        fs::write(
            layout.join("oci-layout"),
            r#"{"imageLayoutVersion":"1.0.0"}"#,
        )
        .unwrap();
        fs::write(
            layout.join("index.json"),
            format!(r#"{{"schemaVersion":2,"manifests":[{named}]}}"#),
        )
        .unwrap();

        let options = LoadImageOptions {
            layout_path: layout.display().to_string(),
            root_path: dir.join("root").display().to_string(),
        };
        let report = load(&options).unwrap();
        assert_eq!(
            serde_json::to_string(&report).unwrap(),
            format!(
                r#"{{"images":[{{"digest":"{manifest_digest}","reference":"radius.local/dev/echo:1"}}],"protocolVersion":1,"type":"radius.runtime.images-loaded"}}"#
            )
        );
        let references: BTreeMap<String, String> =
            read_json(&dir.join("root").join("images.json")).unwrap();
        assert_eq!(references["radius.local/dev/echo:1"], manifest_digest);
        let stored_layer = dir
            .join("root")
            .join("blobs")
            .join("sha256")
            .join(&layer_digest[7..]);
        assert!(stored_layer.is_file());

        fs::write(
            layout.join("blobs").join("sha256").join(&layer_digest[7..]),
            b"LAYER BYTES",
        )
        .unwrap();
        let tampered_root = dir.join("tampered");
        let error = load(&LoadImageOptions {
            root_path: tampered_root.display().to_string(),
            ..options
        })
        .unwrap_err();
        assert!(error.message().contains("does not match"), "{error}");
        let leftovers: Vec<_> = fs::read_dir(tampered_root.join("blobs").join("sha256"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .filter(|name| name.starts_with(&layer_digest[7..]))
            .collect();
        assert!(leftovers.is_empty(), "left behind: {leftovers:?}");

        fs::remove_dir_all(&dir).ok();
    }
}
