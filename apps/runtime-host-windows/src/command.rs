use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf, Prefix};

use crate::error::{RuntimeHostError, invalid};
use crate::random::random_uuid;

pub const USAGE: &str = "Usage:
  radius-runtime-host doctor [--json]
  radius-runtime-host load-image --layout PATH --root PATH
  radius-runtime-host run --image IMAGE@sha256:DIGEST --kernel PATH --root PATH [options] [-- ARGUMENTS...]

Run options:
  --initfs REFERENCE          Guest init image (default: the pinned radius-vminit image)
  --container-id ID           Stable local container identifier
  --cpus COUNT                Virtual CPU count (default: 2)
  --memory-mb COUNT           Guest memory in MiB (default: 4096)
  --rootfs-mb COUNT           Read-only root filesystem size in MiB (default: 5120)
  --writable-mb COUNT         Writable overlay size in MiB (default: 5120)
  --process-limit COUNT       Maximum guest processes (default: 256)
  --open-file-limit COUNT     Maximum open files per process (default: 1024)
  --user UID:GID              Non-root OCI user (default: 1000:1000)
  --rosetta                   macOS only; rejected on Windows (use a linux/amd64 image)
  --developer-state-share PATH
                              Share a directory beneath %APPDATA%\\Radius (or Radius-<id>) at /opt/data
  --no-network                Start without an outbound NAT interface
  --port-forward SPEC         Forward host ports to the agent's own loopback inside the guest (an
                              OpenVMM consomme hostfwd= spec, e.g. hostfwd=tcp::1455-:1455), for a
                              command that must receive an inbound connection such as an OAuth
                              loopback redirect. Every entry's guest port is relayed to 127.0.0.1
                              in the guest, where such a redirect server listens
  --allow-unpinned-image      Developer-only escape hatch for a tagged fixture image
  --allow-root                Developer-only escape hatch for a root image user";

const DEFAULT_USER: &str = "1000:1000";

const RUN_VALUE_OPTIONS: [&str; 14] = [
    "--image",
    "--kernel",
    "--root",
    "--initfs",
    "--container-id",
    "--cpus",
    "--memory-mb",
    "--rootfs-mb",
    "--writable-mb",
    "--user",
    "--process-limit",
    "--open-file-limit",
    "--developer-state-share",
    "--port-forward",
];

const RUN_FLAG_OPTIONS: [&str; 4] = [
    "--rosetta",
    "--no-network",
    "--allow-unpinned-image",
    "--allow-root",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeCommand {
    Doctor {
        json: bool,
    },
    LoadImage(LoadImageOptions),
    Run(Box<RunOptions>),
}

impl RuntimeCommand {
    pub fn parse<S: AsRef<str>>(arguments: &[S]) -> Result<Self, RuntimeHostError> {
        let arguments: Vec<&str> = arguments.iter().map(AsRef::as_ref).collect();
        let Some((command, remainder)) = arguments.split_first() else {
            return Err(invalid(USAGE));
        };

        match *command {
            "doctor" => {
                if !remainder.iter().all(|argument| *argument == "--json") {
                    return Err(invalid(USAGE));
                }
                Ok(Self::Doctor {
                    json: remainder.contains(&"--json"),
                })
            }
            "load-image" => Ok(Self::LoadImage(LoadImageOptions::parse(remainder)?)),
            "run" => Ok(Self::Run(Box::new(RunOptions::parse(remainder)?))),
            "help" | "--help" | "-h" => Err(RuntimeHostError::HelpRequested(USAGE.to_owned())),
            other => Err(invalid(format!("Unknown command '{other}'.\n\n{USAGE}"))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadImageOptions {
    pub layout_path: String,
    pub root_path: String,
}

impl LoadImageOptions {
    pub fn parse(arguments: &[&str]) -> Result<Self, RuntimeHostError> {
        let mut values: BTreeMap<&str, &str> = BTreeMap::new();
        let mut index = 0;
        while index < arguments.len() {
            let option = arguments[index];
            if option != "--layout" && option != "--root" {
                return Err(invalid(format!("Unknown load-image option '{option}'")));
            }
            let Some(value) = arguments.get(index + 1) else {
                return Err(invalid(format!("Missing value for {option}")));
            };
            if values.contains_key(option) {
                return Err(invalid(format!("Duplicate option {option}")));
            }
            values.insert(option, value);
            index += 2;
        }

        Ok(Self {
            layout_path: required("--layout", &values)?.to_owned(),
            root_path: required("--root", &values)?.to_owned(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunOptions {
    pub image_reference: String,
    pub kernel_path: String,
    pub root_path: String,
    pub initfs_reference: Option<String>,
    pub container_id: String,
    pub cpus: u64,
    pub memory_mib: u64,
    pub rootfs_mib: u64,
    pub writable_mib: u64,
    pub process_limit: u64,
    pub open_file_limit: u64,
    pub user: String,
    pub developer_state_share_path: Option<PathBuf>,
    pub network_enabled: bool,
    pub port_forward: Option<String>,
    pub allow_unpinned_image: bool,
    pub allow_root: bool,
    pub arguments: Vec<String>,
}

impl RunOptions {
    pub fn parse(arguments: &[&str]) -> Result<Self, RuntimeHostError> {
        let app_data = std::env::var_os("APPDATA").map(PathBuf::from);
        Self::parse_with_app_data(arguments, app_data.as_deref())
    }

    pub fn parse_with_app_data(
        arguments: &[&str],
        app_data: Option<&Path>,
    ) -> Result<Self, RuntimeHostError> {
        let mut values: BTreeMap<&str, &str> = BTreeMap::new();
        let mut flags: BTreeSet<&str> = BTreeSet::new();
        let mut process_arguments: Vec<String> = Vec::new();
        let mut index = 0;

        while index < arguments.len() {
            let argument = arguments[index];
            if argument == "--" {
                process_arguments = arguments[index + 1..]
                    .iter()
                    .map(|argument| (*argument).to_owned())
                    .collect();
                break;
            }
            if RUN_VALUE_OPTIONS.contains(&argument) {
                let Some(value) = arguments.get(index + 1) else {
                    return Err(invalid(format!("Missing value for {argument}")));
                };
                if values.contains_key(argument) {
                    return Err(invalid(format!("Duplicate option {argument}")));
                }
                values.insert(argument, value);
                index += 2;
                continue;
            }
            if RUN_FLAG_OPTIONS.contains(&argument) {
                if !flags.insert(argument) {
                    return Err(invalid(format!("Duplicate flag {argument}")));
                }
                index += 1;
                continue;
            }
            return Err(invalid(format!("Unknown run option '{argument}'")));
        }

        let image = required("--image", &values)?;
        let kernel = required("--kernel", &values)?;
        let root = required("--root", &values)?;
        let allow_unpinned_image = flags.contains("--allow-unpinned-image");
        if !allow_unpinned_image && !is_digest_pinned(image) {
            return Err(invalid(
                "Agent images must be addressed by sha256 digest. Use --allow-unpinned-image only for a local developer fixture.",
            ));
        }

        let user = values.get("--user").copied().unwrap_or(DEFAULT_USER);
        let allow_root = flags.contains("--allow-root");
        if !allow_root && is_root_user(user) {
            return Err(invalid(
                "Agent images must run as a non-root user. Use --allow-root only for a local developer fixture.",
            ));
        }

        if flags.contains("--rosetta") {
            return Err(invalid(
                "--rosetta is only available on macOS. On Windows, use a linux/amd64 image.",
            ));
        }

        let port_forward = values.get("--port-forward").copied();
        if port_forward.is_some_and(str::is_empty) {
            return Err(invalid("--port-forward must not be empty"));
        }
        if port_forward.is_some() && flags.contains("--no-network") {
            return Err(invalid("--port-forward requires network to be enabled"));
        }

        Ok(Self {
            image_reference: image.to_owned(),
            kernel_path: kernel.to_owned(),
            root_path: root.to_owned(),
            initfs_reference: values.get("--initfs").map(|value| (*value).to_owned()),
            container_id: values
                .get("--container-id")
                .map(|value| (*value).to_owned())
                .unwrap_or_else(|| format!("radius-agent-{}", random_uuid())),
            cpus: positive_integer("--cpus", values.get("--cpus").copied().unwrap_or("2"))?,
            memory_mib: positive_integer(
                "--memory-mb",
                values.get("--memory-mb").copied().unwrap_or("4096"),
            )?,
            rootfs_mib: positive_integer(
                "--rootfs-mb",
                values.get("--rootfs-mb").copied().unwrap_or("5120"),
            )?,
            writable_mib: positive_integer(
                "--writable-mb",
                values.get("--writable-mb").copied().unwrap_or("5120"),
            )?,
            process_limit: positive_integer(
                "--process-limit",
                values.get("--process-limit").copied().unwrap_or("256"),
            )?,
            open_file_limit: positive_integer(
                "--open-file-limit",
                values.get("--open-file-limit").copied().unwrap_or("1024"),
            )?,
            user: user.to_owned(),
            developer_state_share_path: developer_state_share_path(
                values.get("--developer-state-share").copied(),
                app_data,
            )?,
            network_enabled: !flags.contains("--no-network"),
            port_forward: port_forward.map(str::to_owned),
            allow_unpinned_image,
            allow_root,
            arguments: process_arguments,
        })
    }
}

pub fn is_digest_pinned(reference: &str) -> bool {
    let Some((_, digest)) = reference.split_once("@sha256:") else {
        return false;
    };
    digest.len() == 64
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_root_user(user: &str) -> bool {
    user == "root" || user == "0" || user.starts_with("0:")
}

fn required<'a>(
    option: &str,
    values: &BTreeMap<&str, &'a str>,
) -> Result<&'a str, RuntimeHostError> {
    match values.get(option) {
        Some(value) if !value.is_empty() => Ok(value),
        _ => Err(invalid(format!("Missing required option {option}"))),
    }
}

fn positive_integer(option: &str, value: &str) -> Result<u64, RuntimeHostError> {
    match value.parse::<i64>() {
        Ok(parsed) if parsed > 0 => Ok(parsed.unsigned_abs()),
        _ => Err(invalid(format!("{option} must be a positive integer"))),
    }
}

fn developer_state_share_path(
    raw_path: Option<&str>,
    app_data: Option<&Path>,
) -> Result<Option<PathBuf>, RuntimeHostError> {
    let Some(raw_path) = raw_path else {
        return Ok(None);
    };
    let outside = || {
        invalid(
            "--developer-state-share must resolve beneath the Radius application data directory",
        )
    };
    let Some(app_data) = app_data else {
        return Err(outside());
    };

    let app_data = normalize(app_data);
    let candidate = normalize(Path::new(raw_path));
    let depth = app_data.components().count();
    let profile = candidate
        .components()
        .nth(depth)
        .map(|component| component.as_os_str().to_string_lossy().to_lowercase());
    let is_radius_profile = profile
        .as_deref()
        .is_some_and(|name| name == "radius" || name.len() > 7 && name.starts_with("radius-"));
    if !is_radius_profile
        || !is_strictly_beneath(&candidate, &app_data)
        || candidate.components().count() <= depth + 1
    {
        return Err(outside());
    }
    if !candidate.is_dir() {
        return Err(invalid(
            "--developer-state-share must reference an existing directory",
        ));
    }
    Ok(Some(candidate))
}

fn normalize(path: &Path) -> PathBuf {
    if let Ok(resolved) = std::fs::canonicalize(path) {
        return without_verbatim_disk_prefix(resolved);
    }
    let absolute = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

/// Strips the `\\?\` prefix that canonicalize adds.
fn without_verbatim_disk_prefix(path: PathBuf) -> PathBuf {
    let mut components = path.components();
    match components.next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::VerbatimDisk(letter) => {
                let mut rebuilt = PathBuf::from(format!("{}:\\", char::from(letter)));
                rebuilt.extend(
                    components.skip_while(|component| matches!(component, Component::RootDir)),
                );
                rebuilt
            }
            _ => path,
        },
        _ => path,
    }
}

fn is_strictly_beneath(candidate: &Path, root: &Path) -> bool {
    let candidate: Vec<Component<'_>> = candidate.components().collect();
    let root: Vec<Component<'_>> = root.components().collect();
    candidate.len() > root.len()
        && candidate
            .iter()
            .zip(&root)
            .all(|(left, right)| same_component(left, right))
        && !candidate
            .iter()
            .any(|component| matches!(component, Component::ParentDir))
}

fn same_component(left: &Component<'_>, right: &Component<'_>) -> bool {
    if cfg!(windows) {
        left.as_os_str().to_string_lossy().to_lowercase()
            == right.as_os_str().to_string_lossy().to_lowercase()
    } else {
        left == right
    }
}
