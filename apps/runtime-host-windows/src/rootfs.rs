use std::ffi::c_void;
use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom};
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use std::time::Duration;

use fs_ext4::block_io::{BlockDevice, FileDevice};

use crate::error::{RuntimeHostError, io_failure};
use crate::image_store::ResolvedImage;
use crate::vm::{self, DATA_FILE, DIRECTORY, EXECUTABLE, Vm};

const MIB: u64 = 1_048_576;
const BUILD_TIMEOUT: Duration = Duration::from_secs(600);

pub struct VmAssets<'a> {
    pub openvmm: &'a Path,
    pub kernel: &'a Path,
    pub rootfs_builder: &'a [u8],
}

pub fn code_disk(
    root: &Path,
    image: &ResolvedImage,
    assets: &VmAssets<'_>,
    rootfs_mib: u64,
    cpus: u64,
    memory_mib: u64,
) -> Result<PathBuf, RuntimeHostError> {
    let hex = &image.manifest_digest["sha256:".len()..];
    let cache = root.join("rootfs");
    let disk = cache.join(format!("{hex}.erofs"));
    if disk.is_file() {
        return Ok(disk);
    }

    let work = cache.join(format!("{hex}.building"));
    if work.exists() {
        fs::remove_dir_all(&work).map_err(|error| io_failure(&work, error))?;
    }
    fs::create_dir_all(&work).map_err(|error| io_failure(&work, error))?;

    let build_disk = work.join("build.img");
    let mut file = create_sparse(&build_disk)?;
    let mut layers = Vec::new();
    let mut offset: u64 = 0;
    for layer in &image.layers {
        let mut blob = File::open(&layer.path).map_err(|error| io_failure(&layer.path, error))?;
        let size =
            io::copy(&mut blob, &mut file).map_err(|error| io_failure(&build_disk, error))?;
        layers.push(serde_json::json!({
            "offset": offset,
            "size": size,
            "mediaType": layer.media_type,
        }));
        offset += size;
    }
    let output_offset = offset.next_multiple_of(MIB);
    let output_capacity = rootfs_mib * MIB;
    file.set_len(output_offset + output_capacity)
        .map_err(|error| io_failure(&build_disk, error))?;
    drop(file);

    let config = serde_json::to_vec(&serde_json::json!({
        "schemaVersion": 1,
        "layers": layers,
        "outputOffset": output_offset,
        "outputCapacity": output_capacity,
    }))
    .expect("JSON values serialize");
    let initrd = work.join("initrd.cpio");
    let archive = vm::newc_archive(&[
        ("dev", DIRECTORY, &[]),
        ("radius", DIRECTORY, &[]),
        ("radius/build.json", DATA_FILE, &config),
        ("radius-rootfs-builder", EXECUTABLE, assets.rootfs_builder),
    ]);
    fs::write(&initrd, archive).map_err(|error| io_failure(&initrd, error))?;

    let boot_log = work.join("boot.log");
    let mut openvmm = vm::start(&Vm {
        openvmm: assets.openvmm,
        kernel: assets.kernel,
        initrd: &initrd,
        command_line: "console=ttyS0 panic=-1 rdinit=/radius-rootfs-builder",
        cpus,
        memory_mib,
        boot_log: &boot_log,
        openvmm_log: &work.join("openvmm.log"),
        disks: &[(&build_disk, false)],
        console_pipe: None,
        com2_pipe: None,
        network: false,
        port_forward: None,
        shared_folder: None,
    })?;
    let exit_code = vm::wait(&mut openvmm, Some(BUILD_TIMEOUT))?;

    let log = String::from_utf8_lossy(&fs::read(&boot_log).unwrap_or_default()).into_owned();
    let marker = |prefix: &str| {
        log.lines()
            .find_map(|line| line.split(prefix).nth(1).map(|rest| rest.trim().to_owned()))
    };
    let bytes = marker("RADIUS-ROOTFS: done bytes=").and_then(|text| text.parse::<u64>().ok());
    let bytes = match bytes {
        Some(bytes) if exit_code == 0 && bytes <= output_capacity => bytes,
        _ => {
            let reason = marker("RADIUS-ROOTFS: error: ")
                .unwrap_or_else(|| format!("the builder VM stopped with exit code {exit_code}"));
            return Err(RuntimeHostError::Runtime(format!(
                "Could not build the code disk for {}: {reason}. See {}",
                image.manifest_digest,
                boot_log.display()
            )));
        }
    };

    let partial = cache.join(format!("{hex}.erofs.partial"));
    let mut source = File::open(&build_disk).map_err(|error| io_failure(&build_disk, error))?;
    source
        .seek(SeekFrom::Start(output_offset))
        .map_err(|error| io_failure(&build_disk, error))?;
    let mut target = File::create(&partial).map_err(|error| io_failure(&partial, error))?;
    let copied = io::copy(&mut source.take(bytes), &mut target)
        .map_err(|error| io_failure(&partial, error))?;
    if copied != bytes {
        return Err(RuntimeHostError::Runtime(format!(
            "The builder VM reported {bytes} bytes but only {copied} could be read"
        )));
    }
    target
        .sync_all()
        .map_err(|error| io_failure(&partial, error))?;
    drop(target);
    fs::rename(&partial, &disk).map_err(|error| io_failure(&disk, error))?;
    let _ = fs::remove_dir_all(&work);
    Ok(disk)
}

pub fn writable_disk(path: &Path, size_mib: u64) -> Result<(), RuntimeHostError> {
    let size = size_mib * MIB;
    create_sparse(path)?
        .set_len(size)
        .map_err(|error| io_failure(path, error))?;
    let text = path.to_str().ok_or_else(|| {
        RuntimeHostError::Runtime(format!("Disk path is not Unicode: {}", path.display()))
    })?;
    let formatted = FileDevice::open_rw(text).and_then(|device| {
        fs_ext4::mkfs::format_filesystem(&device, Some("radius-writable"), None, size, 4096)?;
        device.flush()
    });
    formatted.map_err(|error| {
        RuntimeHostError::Runtime(format!(
            "Could not format the writable disk {}: {error}",
            path.display()
        ))
    })?;
    repair_superblock(path)
}

// Workaround for an am-fs-ext4 0.5.1 bug (hash seed written at 0xE4, not 0xEC); delete once fixed.
fn repair_superblock(path: &Path) -> Result<(), RuntimeHostError> {
    let failed = |error: io::Error| io_failure(path, error);
    let mut file = File::options()
        .read(true)
        .write(true)
        .open(path)
        .map_err(failed)?;
    let mut superblock = [0u8; 1024];
    file.seek(SeekFrom::Start(1024)).map_err(failed)?;
    file.read_exact(&mut superblock).map_err(failed)?;
    superblock[0xE4..0xEC].fill(0);
    let checksum = superblock_checksum(&superblock);
    superblock[0x3FC..].copy_from_slice(&checksum.to_le_bytes());
    file.seek(SeekFrom::Start(1024)).map_err(failed)?;
    io::Write::write_all(&mut file, &superblock).map_err(failed)?;
    file.sync_all().map_err(failed)
}

/// CRC32C without the final inversion, like Linux's ext4_chksum.
fn superblock_checksum(superblock: &[u8; 1024]) -> u32 {
    !crc32c::crc32c(&superblock[..0x3FC])
}

fn create_sparse(path: &Path) -> Result<File, RuntimeHostError> {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn DeviceIoControl(
            device: *mut c_void,
            code: u32,
            input: *const c_void,
            input_length: u32,
            output: *mut c_void,
            output_length: u32,
            returned: *mut u32,
            overlapped: *mut c_void,
        ) -> i32;
    }
    const FSCTL_SET_SPARSE: u32 = 0x0009_00c4;

    let file = File::create_new(path).map_err(|error| io_failure(path, error))?;
    let mut returned = 0u32;
    // SAFETY: `file` is an open handle, and FSCTL_SET_SPARSE takes no input or output buffer.
    let succeeded = unsafe {
        DeviceIoControl(
            file.as_raw_handle().cast(),
            FSCTL_SET_SPARSE,
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            0,
            &mut returned,
            std::ptr::null_mut(),
        )
    };
    if succeeded == 0 {
        return Err(io_failure(path, io::Error::last_os_error()));
    }
    Ok(file)
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use super::*;
    use crate::image_store;

    #[test]
    fn writable_disk_is_a_clean_sparse_ext4_file_that_is_never_reused() {
        let dir =
            std::env::temp_dir().join(format!("radius-writable-{}", crate::random::random_uuid()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("writable.ext4");

        writable_disk(&path, 64).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().len(), 64 * MIB);
        let mut superblock = [0u8; 1024];
        let mut file = File::open(&path).unwrap();
        file.seek(SeekFrom::Start(1024)).unwrap();
        file.read_exact(&mut superblock).unwrap();
        drop(file);
        let field =
            |offset: usize| u32::from_le_bytes(superblock[offset..offset + 4].try_into().unwrap());
        assert_eq!(field(0x38) & 0xFFFF, 0xEF53, "ext4 magic");
        assert_eq!(field(0xE4), 0, "s_journal_dev");
        assert_eq!(field(0xE8), 0, "s_last_orphan");
        assert_eq!(field(0x3FC), superblock_checksum(&superblock), "s_checksum");

        assert!(
            writable_disk(&path, 64).is_err(),
            "an existing disk is refused"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// Needs the RADIUS_TEST_* variables: `cargo test --lib builds_code_disk_in_a_vm -- --ignored`.
    #[test]
    #[ignore = "boots a VM; needs OpenVMM, the kernel, the builder and an imported image"]
    fn builds_code_disk_in_a_vm() {
        let env = |name: &str| {
            PathBuf::from(std::env::var_os(name).unwrap_or_else(|| panic!("set {name}")))
        };
        let (openvmm, kernel) = (env("RADIUS_TEST_OPENVMM"), env("RADIUS_TEST_KERNEL"));
        let builder = fs::read(env("RADIUS_TEST_ROOTFS_BUILDER")).unwrap();
        let root = env("RADIUS_TEST_RUNTIME_ROOT");
        let reference = std::env::var("RADIUS_TEST_IMAGE").expect("set RADIUS_TEST_IMAGE");
        let assets = VmAssets {
            openvmm: &openvmm,
            kernel: &kernel,
            rootfs_builder: &builder,
        };
        let image = image_store::resolve(&root, &reference).unwrap();

        let started = Instant::now();
        let disk = code_disk(&root, &image, &assets, 2048, 2, 2048).unwrap();
        let first_request = started.elapsed();
        let mut magic = [0u8; 4];
        let mut file = File::open(&disk).unwrap();
        file.seek(SeekFrom::Start(1024)).unwrap();
        file.read_exact(&mut magic).unwrap();
        assert_eq!(u32::from_le_bytes(magic), 0xE0F5_E1E2, "erofs magic");

        let started = Instant::now();
        assert_eq!(
            code_disk(&root, &image, &assets, 2048, 2, 2048).unwrap(),
            disk
        );
        let second_request = started.elapsed();
        assert!(second_request < Duration::from_secs(1));
        println!(
            "code disk {} ({} bytes): first request {first_request:?}, second request {second_request:?}",
            disk.display(),
            fs::metadata(&disk).unwrap().len()
        );

        let writable = root.join(format!(
            "check-writable-{}.ext4",
            crate::random::random_uuid()
        ));
        writable_disk(&writable, 64).unwrap();
        println!("writable disk {}", writable.display());
    }
}
