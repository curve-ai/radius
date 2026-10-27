use std::ffi::c_void;
use std::fs::File;
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use crate::error::{RuntimeHostError, runtime};

pub const DIRECTORY: u32 = 0o040_755;
pub const EXECUTABLE: u32 = 0o100_755;
pub const DATA_FILE: u32 = 0o100_644;

pub const STATE_SHARE_TAG: &str = "radiusdata";

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct Vm<'a> {
    pub openvmm: &'a Path,
    pub kernel: &'a Path,
    pub initrd: &'a Path,
    pub command_line: &'a str,
    pub cpus: u64,
    pub memory_mib: u64,
    pub boot_log: &'a Path,
    pub openvmm_log: &'a Path,
    pub disks: &'a [(&'a Path, bool)],
    pub console_pipe: Option<&'a str>,
    pub com2_pipe: Option<&'a str>,
    pub network: bool,
    pub port_forward: Option<&'a str>,
    pub shared_folder: Option<(&'a Path, u32, u32)>,
}

pub fn start(vm: &Vm<'_>) -> Result<Child, RuntimeHostError> {
    contain_child_processes()?;

    let mut arguments: Vec<String> = vec![
        "-p".into(),
        vm.cpus.to_string(),
        "--memory".into(),
        format!("{}M", vm.memory_mib),
        "-k".into(),
        path_text(vm.kernel)?,
        "-r".into(),
        path_text(vm.initrd)?,
        "-c".into(),
        vm.command_line.into(),
        "--com1".into(),
        format!("file={}", path_text(vm.boot_log)?),
        "--guest-shutdown-action".into(),
        "exit".into(),
        "--guest-crash-action".into(),
        "exit:3".into(),
        "--guest-reset-action".into(),
        "exit:4".into(),
    ];
    if let Some(pipe) = vm.com2_pipe {
        arguments.extend(["--com2".into(), format!("listen=//./pipe/{pipe}")]);
    }

    let needs_pcie = !vm.disks.is_empty()
        || vm.console_pipe.is_some()
        || vm.network
        || vm.shared_folder.is_some();
    if needs_pcie {
        arguments.extend(["--pcie-root-complex".into(), "rc0".into()]);
    }
    let mut ports = 0;
    let mut root_port = |arguments: &mut Vec<String>| {
        let name = format!("rp{ports}");
        ports += 1;
        arguments.extend(["--pcie-root-port".into(), format!("rc0:{name}")]);
        name
    };
    for (path, read_only) in vm.disks {
        let port = root_port(&mut arguments);
        arguments.extend([
            "--virtio-blk".into(),
            format!(
                "file:{}{},pcie_port={port}",
                path_text(path)?,
                if *read_only { ",ro" } else { "" }
            ),
        ]);
    }
    if let Some(pipe) = vm.console_pipe {
        let port = root_port(&mut arguments);
        arguments.extend([
            "--virtio-console".into(),
            format!("listen=//./pipe/{pipe}"),
            "--virtio-console-pcie-port".into(),
            port,
        ]);
    }
    if vm.network {
        let port = root_port(&mut arguments);
        let suffix = vm
            .port_forward
            .map(|spec| format!(":{spec}"))
            .unwrap_or_default();
        arguments.extend([
            "--virtio-net".into(),
            format!("pcie_port={port}:consomme{suffix}"),
        ]);
    }
    if let Some((folder, uid, gid)) = vm.shared_folder {
        let port = root_port(&mut arguments);
        arguments.extend([
            "--virtio-fs".into(),
            format!(
                // OpenVMM reads these as decimal and swaps them: fmask is for directories (0o077), dmask for files (0o177).
                "pcie_port={port}:{STATE_SHARE_TAG},{},uid={uid},gid={gid},fmask=63,dmask=127",
                path_text(folder)?
            ),
        ]);
    }

    let failed = |error: std::io::Error| {
        runtime(format!("Could not start {}: {error}", vm.openvmm.display()))
    };
    let log = File::create(vm.openvmm_log).map_err(failed)?;
    Command::new(vm.openvmm)
        .args(&arguments)
        // OpenVMM needs a console and an open stdin, but no window.
        .stdin(Stdio::piped())
        .stdout(log.try_clone().map_err(failed)?)
        .stderr(log)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(failed)
}

pub fn wait(openvmm: &mut Child, timeout: Option<Duration>) -> Result<i32, RuntimeHostError> {
    let failed = |error: std::io::Error| runtime(format!("Could not wait for OpenVMM: {error}"));
    let Some(timeout) = timeout else {
        return Ok(openvmm.wait().map_err(failed)?.code().unwrap_or(-1));
    };
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = openvmm.try_wait().map_err(failed)? {
            return Ok(status.code().unwrap_or(-1));
        }
        if Instant::now() >= deadline {
            kill(openvmm);
            return Err(runtime(format!(
                "The VM did not power off within {} seconds",
                timeout.as_secs()
            )));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

pub fn kill(openvmm: &mut Child) {
    let _ = Command::new("taskkill")
        .args(["/T", "/F", "/PID", &openvmm.id().to_string()])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
    let _ = openvmm.wait();
}

pub fn newc_archive(entries: &[(&str, u32, &[u8])]) -> Vec<u8> {
    let mut archive = Vec::new();
    let trailer: (&str, u32, &[u8]) = ("TRAILER!!!", 0, &[]);
    for (index, (name, mode, data)) in entries.iter().chain([&trailer]).enumerate() {
        let links = if mode & 0o170_000 == 0o040_000 { 2 } else { 1 };
        let fields = [
            index + 1,      // inode
            *mode as usize, // mode
            0,              // uid
            0,              // gid
            links,          // nlink
            0,              // mtime
            data.len(),     // file size
            0,              // dev major
            0,              // dev minor
            0,              // rdev major
            0,              // rdev minor
            name.len() + 1, // name size, with the NUL
            0,              // checksum (unused by newc)
        ];
        archive.extend_from_slice(b"070701");
        for field in fields {
            archive.extend_from_slice(format!("{field:08x}").as_bytes());
        }
        archive.extend_from_slice(name.as_bytes());
        archive.push(0);
        pad_to_four(&mut archive);
        archive.extend_from_slice(data);
        pad_to_four(&mut archive);
    }
    archive
}

fn pad_to_four(archive: &mut Vec<u8>) {
    archive.resize(archive.len().next_multiple_of(4), 0);
}

fn path_text(path: &Path) -> Result<String, RuntimeHostError> {
    match path.to_str() {
        Some(text) if !text.contains(',') => Ok(text.to_owned()),
        _ => Err(runtime(format!(
            "VM file paths must be Unicode without commas: {}",
            path.display()
        ))),
    }
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> *mut c_void;
    fn SetInformationJobObject(
        job: *mut c_void,
        class: i32,
        information: *const c_void,
        length: u32,
    ) -> i32;
    fn AssignProcessToJobObject(job: *mut c_void, process: *mut c_void) -> i32;
    fn GetCurrentProcess() -> *mut c_void;
}

const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;

#[repr(C)]
struct BasicLimitInformation {
    per_process_user_time_limit: i64,
    per_job_user_time_limit: i64,
    limit_flags: u32,
    minimum_working_set_size: usize,
    maximum_working_set_size: usize,
    active_process_limit: u32,
    affinity: usize,
    priority_class: u32,
    scheduling_class: u32,
}

#[repr(C)]
struct ExtendedLimitInformation {
    basic: BasicLimitInformation,
    io_counters: [u64; 6],
    process_memory_limit: usize,
    job_memory_limit: usize,
    peak_process_memory_used: usize,
    peak_job_memory_used: usize,
}

fn contain_child_processes() -> Result<(), RuntimeHostError> {
    static CONTAINED: OnceLock<Result<(), String>> = OnceLock::new();
    CONTAINED
        .get_or_init(|| {
            let failed = |step: &str| {
                format!(
                    "Could not put the runtime host in a Job Object ({step}): {}",
                    std::io::Error::last_os_error()
                )
            };
            // SAFETY: plain Win32 calls; the zeroed struct is all integers. The job handle is never closed on purpose.
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return Err(failed("CreateJobObjectW"));
                }
                let mut limits: ExtendedLimitInformation = std::mem::zeroed();
                limits.basic.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let length = u32::try_from(size_of::<ExtendedLimitInformation>())
                    .expect("struct size fits in u32");
                if SetInformationJobObject(
                    job,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                    (&raw const limits).cast(),
                    length,
                ) == 0
                {
                    return Err(failed("SetInformationJobObject"));
                }
                if AssignProcessToJobObject(job, GetCurrentProcess()) == 0 {
                    return Err(failed("AssignProcessToJobObject"));
                }
            }
            Ok(())
        })
        .clone()
        .map_err(RuntimeHostError::Runtime)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newc_archive_uses_explicit_modes_and_ends_with_a_trailer() {
        let archive = newc_archive(&[
            ("radius", DIRECTORY, b""),
            ("radius/init", EXECUTABLE, b"hi"),
        ]);
        assert_eq!(archive.len() % 4, 0);

        let first = std::str::from_utf8(&archive[..110]).unwrap();
        assert_eq!(&first[..6], "070701");
        assert_eq!(&first[14..22], "000041ed", "directory mode 040755");
        assert_eq!(&first[94..102], "00000007", "name size of \"radius\\0\"");
        assert_eq!(&archive[110..117], b"radius\0");

        let second = &archive[120..230];
        let second = std::str::from_utf8(second).unwrap();
        assert_eq!(&second[14..22], "000081ed", "executable mode 100755");
        assert_eq!(&second[54..62], "00000002", "file size");
        assert_eq!(&archive[230..242], b"radius/init\0");
        assert_eq!(&archive[244..246], b"hi");

        let tail = String::from_utf8_lossy(&archive[archive.len() - 24..]).into_owned();
        assert!(tail.contains("TRAILER!!!\0"), "{tail:?}");
    }
}
