use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom};
use std::os::unix::fs::FileExt;

use flate2::read::MultiGzDecoder;
use fs_erofs::mkfs::{self, Node, NodeMeta};
use serde::Deserialize;
use tar::{Archive, Entry, EntryType};

const CONFIG_PATH: &str = "/radius/build.json";
const DISK: &str = "/dev/vda";

const S_IFIFO: u16 = 0o010_000;
const S_IFCHR: u16 = 0o020_000;
const S_IFDIR: u16 = 0o040_000;
const S_IFBLK: u16 = 0o060_000;
const S_IFREG: u16 = 0o100_000;
const S_IFLNK: u16 = 0o120_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BuildConfig {
    schema_version: u32,
    layers: Vec<Layer>,
    output_offset: u64,
    output_capacity: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Layer {
    offset: u64,
    size: u64,
    media_type: String,
}

fn main() {
    match run() {
        Ok(bytes) => println!("RADIUS-ROOTFS: done bytes={bytes}"),
        Err(message) => println!("RADIUS-ROOTFS: error: {message}"),
    }
    power_off();
}

fn run() -> Result<usize, String> {
    mount_dev()?;
    let text =
        fs::read_to_string(CONFIG_PATH).map_err(|error| format!("read {CONFIG_PATH}: {error}"))?;
    let config: BuildConfig =
        serde_json::from_str(&text).map_err(|error| format!("parse {CONFIG_PATH}: {error}"))?;
    if config.schema_version != 1 {
        return Err(format!(
            "unsupported {CONFIG_PATH} schemaVersion {}",
            config.schema_version
        ));
    }
    let disk = File::options()
        .read(true)
        .write(true)
        .open(DISK)
        .map_err(|error| format!("open {DISK}: {error}"))?;

    let mut root = directory(S_IFDIR | 0o755, NodeMeta::default());
    let mut file_bytes: u64 = 0;
    for layer in &config.layers {
        read_layer(&disk, layer, |path, _| {
            if let Some((name, parent)) = path.split_last()
                && let Some(hidden) = name.strip_prefix(".wh.")
                && let Some(entries) = existing_directory(&mut root, parent)
            {
                // `.wh..wh..opq` marks an opaque directory; any other `.wh.<name>` deletes `<name>`.
                if hidden == ".wh..opq" {
                    entries.clear();
                } else {
                    entries.remove(hidden);
                }
            }
            Ok(())
        })?;
        read_layer(&disk, layer, |path, entry| {
            add_entry(
                &mut root,
                &path,
                entry,
                &mut file_bytes,
                config.output_capacity,
            )
        })?;
    }

    // Known limit: the whole tree and image are held in guest memory.
    let image =
        mkfs::build_image(root, 12).map_err(|error| format!("build erofs image: {error:?}"))?;
    if image.len() as u64 > config.output_capacity {
        return Err(format!(
            "image needs {} bytes but the root filesystem limit is {} bytes",
            image.len(),
            config.output_capacity
        ));
    }
    disk.write_all_at(&image, config.output_offset)
        .and_then(|()| disk.sync_all())
        .map_err(|error| format!("write image to {DISK}: {error}"))?;
    Ok(image.len())
}

fn read_layer(
    disk: &File,
    layer: &Layer,
    mut visit: impl FnMut(Vec<String>, &mut Entry<'_, Box<dyn Read>>) -> Result<(), String>,
) -> Result<(), String> {
    let mut source = disk.try_clone().map_err(|error| error.to_string())?;
    source
        .seek(SeekFrom::Start(layer.offset))
        .map_err(|error| format!("seek to layer: {error}"))?;
    let source = source.take(layer.size);
    let reader: Box<dyn Read> = match layer.media_type.as_str() {
        "application/vnd.oci.image.layer.v1.tar"
        | "application/vnd.docker.image.rootfs.diff.tar" => Box::new(source),
        "application/vnd.oci.image.layer.v1.tar+gzip"
        | "application/vnd.docker.image.rootfs.diff.tar.gzip" => {
            Box::new(MultiGzDecoder::new(source))
        }
        other => return Err(format!("unsupported layer media type {other}")),
    };

    let mut archive = Archive::new(reader);
    let entries = archive
        .entries()
        .map_err(|error| format!("read layer: {error}"))?;
    for entry in entries {
        let mut entry = entry.map_err(|error| format!("read layer entry: {error}"))?;
        let path = components(&entry.path_bytes())?;
        visit(path, &mut entry)?;
    }
    Ok(())
}

fn add_entry(
    root: &mut Node,
    path: &[String],
    entry: &mut Entry<'_, Box<dyn Read>>,
    file_bytes: &mut u64,
    limit: u64,
) -> Result<(), String> {
    let Some((name, parent)) = path.split_last() else {
        return Ok(());
    };
    if name.starts_with(".wh.") {
        return Ok(());
    }
    let joined = path.join("/");
    let bad = |error: io::Error| format!("{joined}: {error}");
    let header = entry.header();
    let permissions = (header.mode().map_err(bad)? & 0o7777) as u16;
    let meta = NodeMeta {
        uid: u32::try_from(header.uid().map_err(bad)?)
            .map_err(|_| format!("{joined}: uid too large"))?,
        gid: u32::try_from(header.gid().map_err(bad)?)
            .map_err(|_| format!("{joined}: gid too large"))?,
        mtime: header.mtime().map_err(bad)?,
        mtime_nsec: 0,
    };
    let entry_type = header.entry_type();

    let node = match entry_type {
        EntryType::Directory => {
            if let Some(Node::Dir {
                mode,
                meta: existing,
                ..
            }) = directory_entries(root, parent).get_mut(name)
            {
                *mode = S_IFDIR | permissions;
                *existing = meta;
                return Ok(());
            }
            directory(S_IFDIR | permissions, meta)
        }
        EntryType::Regular | EntryType::Continuous => {
            *file_bytes += entry.size();
            if *file_bytes > limit {
                return Err(format!(
                    "image files exceed the root filesystem limit of {limit} bytes"
                ));
            }
            let mut data = Vec::new();
            entry.read_to_end(&mut data).map_err(bad)?;
            Node::File {
                mode: S_IFREG | permissions,
                data,
                meta,
                xattrs: Vec::new(),
            }
        }
        EntryType::Symlink => {
            let target = entry
                .link_name_bytes()
                .ok_or_else(|| format!("{joined}: symlink without a target"))?;
            let target = String::from_utf8(target.into_owned())
                .map_err(|_| format!("{joined}: non-UTF-8 symlink target"))?;
            Node::Symlink {
                mode: S_IFLNK | 0o777,
                target,
                meta,
                xattrs: Vec::new(),
            }
        }
        EntryType::Link => {
            // Known limit: hard links become copies (the erofs builder has no hard-link node).
            let target = entry
                .link_name_bytes()
                .ok_or_else(|| format!("{joined}: hard link without a target"))?;
            let target = components(&target)?;
            match find(root, &target) {
                Some(Node::File {
                    mode, data, meta, ..
                }) => {
                    *file_bytes += data.len() as u64;
                    if *file_bytes > limit {
                        return Err(format!(
                            "image files exceed the root filesystem limit of {limit} bytes"
                        ));
                    }
                    Node::File {
                        mode: *mode,
                        data: data.clone(),
                        meta: *meta,
                        xattrs: Vec::new(),
                    }
                }
                _ => return Err(format!("{joined}: hard link target is not a regular file")),
            }
        }
        EntryType::Char | EntryType::Block => {
            let major = header.device_major().map_err(bad)?.unwrap_or(0);
            let minor = header.device_minor().map_err(bad)?.unwrap_or(0);
            let kind = if entry_type == EntryType::Char {
                S_IFCHR
            } else {
                S_IFBLK
            };
            Node::Device {
                mode: kind | permissions,
                rdev: (minor & 0xff) | (major << 8) | ((minor & !0xff) << 12),
                meta,
                xattrs: Vec::new(),
            }
        }
        EntryType::Fifo => Node::Special {
            mode: S_IFIFO | permissions,
            meta,
            xattrs: Vec::new(),
        },
        _ => return Ok(()),
    };
    directory_entries(root, parent).insert(name.clone(), node);
    Ok(())
}

fn components(raw: &[u8]) -> Result<Vec<String>, String> {
    let text = std::str::from_utf8(raw)
        .map_err(|_| format!("non-UTF-8 path {}", String::from_utf8_lossy(raw)))?;
    let mut parts = Vec::new();
    for part in text.split('/') {
        match part {
            "" | "." => {}
            ".." => return Err(format!("path leaves the image root: {text}")),
            name => parts.push(name.to_owned()),
        }
    }
    Ok(parts)
}

fn directory(mode: u16, meta: NodeMeta) -> Node {
    Node::Dir {
        mode,
        entries: BTreeMap::new(),
        meta,
        xattrs: Vec::new(),
    }
}

fn directory_entries<'a>(root: &'a mut Node, path: &[String]) -> &'a mut BTreeMap<String, Node> {
    let mut node = root;
    for name in path {
        let Node::Dir { entries, .. } = node else {
            unreachable!("only directories are walked");
        };
        let child = entries
            .entry(name.clone())
            .or_insert_with(|| directory(S_IFDIR | 0o755, NodeMeta::default()));
        if !matches!(child, Node::Dir { .. }) {
            *child = directory(S_IFDIR | 0o755, NodeMeta::default());
        }
        node = child;
    }
    let Node::Dir { entries, .. } = node else {
        unreachable!("only directories are walked");
    };
    entries
}

fn existing_directory<'a>(
    root: &'a mut Node,
    path: &[String],
) -> Option<&'a mut BTreeMap<String, Node>> {
    let mut node = root;
    for name in path {
        let Node::Dir { entries, .. } = node else {
            return None;
        };
        node = entries.get_mut(name)?;
    }
    match node {
        Node::Dir { entries, .. } => Some(entries),
        _ => None,
    }
}

fn find<'a>(root: &'a Node, path: &[String]) -> Option<&'a Node> {
    let mut node = root;
    for name in path {
        let Node::Dir { entries, .. } = node else {
            return None;
        };
        node = entries.get(name)?;
    }
    Some(node)
}

fn mount_dev() -> Result<(), String> {
    fs::create_dir_all("/dev").map_err(|error| format!("mkdir /dev: {error}"))?;
    let (source, target, kind) = (c"devtmpfs", c"/dev", c"devtmpfs");
    // SAFETY: all strings are NUL-terminated and no mount data is passed.
    let result = unsafe {
        libc::mount(
            source.as_ptr(),
            target.as_ptr(),
            kind.as_ptr(),
            libc::MS_NOSUID | libc::MS_NOEXEC,
            std::ptr::null(),
        )
    };
    let error = io::Error::last_os_error();
    if result != 0 && error.raw_os_error() != Some(libc::EBUSY) {
        return Err(format!("mount devtmpfs on /dev: {error}"));
    }
    Ok(())
}

fn power_off() -> ! {
    let _ = io::Write::flush(&mut io::stdout());
    // SAFETY: the last calls PID 1 makes; tcdrain keeps power-off messages out of the last boot.log line.
    unsafe {
        libc::tcdrain(libc::STDOUT_FILENO);
        libc::sync();
        libc::reboot(libc::RB_POWER_OFF);
    }
    // PID 1 must never exit, or the kernel panics.
    loop {
        std::thread::park();
    }
}
