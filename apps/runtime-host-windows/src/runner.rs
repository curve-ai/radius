use std::ffi::c_void;
use std::fs;
use std::io::{self, Read, Write};
use std::path::Path;
use std::process::Child;
use std::ptr::{null, null_mut};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::command::RunOptions;
use crate::doctor::RuntimeDoctorReport;
use crate::error::{RuntimeHostError, invalid, io_failure, runtime};
use crate::image_store;
use crate::random::random_uuid;
use crate::rootfs::{self, VmAssets};
use crate::vm::{self, DATA_FILE, DIRECTORY, EXECUTABLE, Vm};

const VMINIT: &[u8] =
    include_bytes!("../.build/guest/x86_64-unknown-linux-musl/release/radius-vminit");
const ROOTFS_BUILDER: &[u8] =
    include_bytes!("../.build/guest/x86_64-unknown-linux-musl/release/radius-rootfs-builder");

const NETWORK_ARGUMENT: &str = "ip=10.0.0.2::10.0.0.1:255.255.255.0::eth0:off:10.0.0.1";
const PIPE_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

const RUN_FILES: [&str; 2] = ["writable.ext4", "initrd.cpio"];
const LEFTOVER_AGE: Duration = Duration::from_secs(600);
const KEPT_RUNS: usize = 50;

fn forwarded_guest_ports(specification: &str) -> Vec<u16> {
    let mut ports: Vec<u16> = specification
        .split(',')
        .filter_map(|entry| entry.rsplit_once('-'))
        .filter_map(|(_, guest)| guest.rsplit_once(':').map_or(guest, |(_, port)| port).parse().ok())
        .collect();
    ports.sort_unstable();
    ports.dedup();
    ports
}

pub fn run(options: &RunOptions) -> Result<i32, RuntimeHostError> {
    let report = RuntimeDoctorReport::current();
    if !report.supported {
        return Err(RuntimeHostError::Unsupported(report.reasons.join(" ")));
    }
    let kernel = Path::new(&options.kernel_path);
    if !kernel.is_file() {
        return Err(invalid(format!(
            "Kernel does not exist at {}",
            kernel.display()
        )));
    }
    if options.initfs_reference.is_some() {
        return Err(invalid(
            "--initfs is not supported on Windows: the guest init is built into the runtime host",
        ));
    }
    let (uid, gid) = numeric_user(&options.user)?;
    if !is_safe_container_id(&options.container_id) {
        return Err(invalid(format!(
            "Container id '{}' may only contain letters, digits, '.', '_' and '-'",
            options.container_id
        )));
    }
    let openvmm = std::env::current_exe()
        .ok()
        .and_then(|exe| Some(exe.parent()?.join("openvmm.exe")))
        .filter(|path| path.is_file())
        .ok_or_else(|| runtime("openvmm.exe is missing next to radius-runtime-host.exe"))?;

    let root = Path::new(&options.root_path);
    let image = image_store::resolve(root, &options.image_reference)?;
    let arguments = if options.arguments.is_empty() {
        &image.process.arguments
    } else {
        &options.arguments
    };
    if arguments.is_empty() {
        return Err(invalid(
            "The image has no entrypoint or command, and no agent arguments were given",
        ));
    }

    let containers = root.join("containers");
    fs::create_dir_all(&containers).map_err(|error| io_failure(&containers, error))?;
    remove_leftover_run_files(&containers);
    remove_old_runs(&containers);
    let container = containers.join(&options.container_id);
    fs::create_dir(&container).map_err(|error| {
        if error.kind() == io::ErrorKind::AlreadyExists {
            runtime(format!(
                "Container state already exists for {}",
                options.container_id
            ))
        } else {
            io_failure(&container, error)
        }
    })?;

    let assets = VmAssets {
        openvmm: &openvmm,
        kernel,
        rootfs_builder: ROOTFS_BUILDER,
    };
    let code_disk = rootfs::code_disk(
        root,
        &image,
        &assets,
        options.rootfs_mib,
        options.cpus,
        options.memory_mib,
    )?;
    let writable_disk = container.join("writable.ext4");
    rootfs::writable_disk(&writable_disk, options.writable_mib)?;

    let config = serde_json::to_vec(&serde_json::json!({
        "schemaVersion": 1,
        "arguments": arguments,
        "user": format!("{uid}:{gid}"),
        "processLimit": options.process_limit,
        "openFileLimit": options.open_file_limit,
        "environment": image.process.environment,
        "workingDirectory": image.process.working_directory.as_deref().unwrap_or("/"),
        "allowRoot": options.allow_root,
        "network": options.network_enabled,
        "stateShare": options.developer_state_share_path.is_some(),
        "loopbackPorts": options.port_forward.as_deref().map(forwarded_guest_ports).unwrap_or_default(),
    }))
    .expect("JSON values serialize");
    let initrd = container.join("initrd.cpio");
    let archive = vm::newc_archive(&[
        ("radius", DIRECTORY, &[]),
        ("radius/config.json", DATA_FILE, &config),
        ("radius-vminit", EXECUTABLE, VMINIT),
    ]);
    fs::write(&initrd, archive).map_err(|error| io_failure(&initrd, error))?;

    let channel = random_uuid();
    let console_pipe = format!("radius-agent-{channel}");
    let errors_pipe = format!("radius-agent-errors-{channel}");
    let command_line = if options.network_enabled {
        format!("console=ttyS0 panic=-1 {NETWORK_ARGUMENT} rdinit=/radius-vminit")
    } else {
        "console=ttyS0 panic=-1 rdinit=/radius-vminit".to_owned()
    };
    let boot_log = container.join("boot.log");
    let openvmm_log = container.join("openvmm.log");
    let mut openvmm_process = vm::start(&Vm {
        openvmm: &openvmm,
        kernel,
        initrd: &initrd,
        command_line: &command_line,
        cpus: options.cpus,
        memory_mib: options.memory_mib,
        boot_log: &boot_log,
        openvmm_log: &openvmm_log,
        disks: &[(&code_disk, true), (&writable_disk, false)],
        console_pipe: Some(&console_pipe),
        com2_pipe: Some(&errors_pipe),
        network: options.network_enabled,
        port_forward: options.port_forward.as_deref(),
        shared_folder: options
            .developer_state_share_path
            .as_deref()
            .map(|folder| (folder, uid, gid)),
    })?;

    let channels = connect(&console_pipe, &mut openvmm_process)
        .and_then(|agent| Ok((agent, connect(&errors_pipe, &mut openvmm_process)?)));
    let (agent, errors) = match channels {
        Ok(channels) => channels,
        Err(error) => {
            vm::kill(&mut openvmm_process);
            return Err(runtime(format!(
                "{} See {}",
                error.message(),
                openvmm_log.display()
            )));
        }
    };
    let agent = Arc::new(agent);
    let output = std::thread::spawn(move || {
        // Forward stdin only after the ready line, or the guest could echo it back.
        if read_ready_line(&agent) {
            let input = Arc::clone(&agent);
            std::thread::spawn(move || copy_stdin_to(&input));
            copy_to_output(&agent, io::stdout());
        }
    });
    let error_output = std::thread::spawn(move || copy_to_output(&errors, io::stderr()));

    let openvmm_exit = vm::wait(&mut openvmm_process, None)?;
    let _ = output.join();
    let _ = error_output.join();
    let _ = fs::remove_file(&writable_disk);
    let _ = fs::remove_file(&initrd);
    agent_exit_code(&boot_log, openvmm_exit)
}

fn remove_leftover_run_files(containers: &Path) {
    let Ok(entries) = fs::read_dir(containers) else {
        return;
    };
    for entry in entries.flatten() {
        for name in RUN_FILES {
            let file = entry.path().join(name);
            let old = fs::metadata(&file)
                .and_then(|metadata| metadata.modified())
                .is_ok_and(|modified| modified.elapsed().is_ok_and(|age| age > LEFTOVER_AGE));
            if old {
                let _ = fs::remove_file(&file);
            }
        }
    }
}

fn remove_old_runs(containers: &Path) {
    let Ok(entries) = fs::read_dir(containers) else {
        return;
    };
    let mut finished: Vec<_> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter(|entry| !RUN_FILES.iter().any(|name| entry.path().join(name).exists()))
        .filter_map(|entry| {
            let metadata = fs::metadata(entry.path().join("boot.log")).or_else(|_| entry.metadata());
            Some((metadata.ok()?.modified().ok()?, entry.path()))
        })
        .collect();
    finished.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, run) in finished.into_iter().skip(KEPT_RUNS) {
        let _ = fs::remove_dir_all(run);
    }
}

const READY_LINE: &[u8] = b"RADIUS-VMINIT-READY\n";

fn read_ready_line(pipe: &Pipe) -> bool {
    let event = new_event();
    let mut line = vec![0u8; READY_LINE.len()];
    let mut filled = 0;
    while filled < line.len() {
        let rest = &mut line[filled..];
        let (pointer, length) = (rest.as_mut_ptr(), rest.len() as u32);
        // SAFETY: `pointer` is valid for `length` bytes and outlives the operation.
        let read = pipe.transfer(event, |overlapped| unsafe {
            ReadFile(pipe.0, pointer, length, null_mut(), overlapped)
        });
        match read {
            Ok(0) | Err(_) => return false,
            Ok(count) => filled += count,
        }
    }
    line == READY_LINE
}

fn agent_exit_code(boot_log: &Path, openvmm_exit: i32) -> Result<i32, RuntimeHostError> {
    let log = String::from_utf8_lossy(&fs::read(boot_log).unwrap_or_default()).into_owned();
    let last_report = |prefix: &str| {
        log.lines().rev().find_map(|line| {
            line.trim_end_matches('\r')
                .strip_prefix(prefix)
                .map(str::to_owned)
        })
    };
    if let Some(error) = last_report("RADIUS-VMINIT: error: ") {
        return Err(runtime(format!(
            "The agent could not start: {error}. See {}",
            boot_log.display()
        )));
    }
    last_report("RADIUS-VMINIT: agent-exit code=")
        .and_then(|code| code.trim().parse().ok())
        .ok_or_else(|| {
            runtime(format!(
                "The agent VM stopped (OpenVMM exit code {openvmm_exit}) before the agent exited. See {}",
                boot_log.display()
            ))
        })
}

fn numeric_user(user: &str) -> Result<(u32, u32), RuntimeHostError> {
    let number = |text: &str| {
        text.bytes()
            .all(|byte| byte.is_ascii_digit())
            .then(|| text.parse().ok())
            .flatten()
    };
    user.split_once(':')
        .and_then(|(uid, gid)| Some((number(uid)?, number(gid)?)))
        .ok_or_else(|| {
            invalid(format!(
                "--user must be a numeric UID:GID on Windows, got '{user}'"
            ))
        })
}

fn is_safe_container_id(id: &str) -> bool {
    !id.is_empty()
        && id != "."
        && id != ".."
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
}

struct Pipe(*mut c_void);

// SAFETY: every ReadFile and WriteFile uses its own OVERLAPPED and event.
unsafe impl Send for Pipe {}
unsafe impl Sync for Pipe {}

#[repr(C)]
struct Overlapped {
    internal: usize,
    internal_high: usize,
    offset: u32,
    offset_high: u32,
    event: *mut c_void,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateFileW(
        name: *const u16,
        access: u32,
        share: u32,
        security: *const c_void,
        disposition: u32,
        flags: u32,
        template: *mut c_void,
    ) -> *mut c_void;
    fn ReadFile(
        file: *mut c_void,
        buffer: *mut u8,
        length: u32,
        read: *mut u32,
        overlapped: *mut Overlapped,
    ) -> i32;
    fn WriteFile(
        file: *mut c_void,
        buffer: *const u8,
        length: u32,
        written: *mut u32,
        overlapped: *mut Overlapped,
    ) -> i32;
    fn GetOverlappedResult(
        file: *mut c_void,
        overlapped: *mut Overlapped,
        transferred: *mut u32,
        wait: i32,
    ) -> i32;
    fn CreateEventW(
        security: *const c_void,
        manual_reset: i32,
        initial_state: i32,
        name: *const u16,
    ) -> *mut c_void;
    fn CloseHandle(handle: *mut c_void) -> i32;
}

const GENERIC_READ: u32 = 0x8000_0000;
const GENERIC_WRITE: u32 = 0x4000_0000;
const OPEN_EXISTING: u32 = 3;
const FILE_FLAG_OVERLAPPED: u32 = 0x4000_0000;
const SECURITY_SQOS_PRESENT: u32 = 0x0010_0000;
const SECURITY_IDENTIFICATION: u32 = 0x0001_0000;
const INVALID_HANDLE_VALUE: *mut c_void = std::ptr::without_provenance_mut(usize::MAX);
const ERROR_FILE_NOT_FOUND: i32 = 2;
const ERROR_PIPE_BUSY: i32 = 231;
const ERROR_IO_PENDING: i32 = 997;

impl Pipe {
    fn transfer(
        &self,
        event: *mut c_void,
        operation: impl FnOnce(*mut Overlapped) -> i32,
    ) -> io::Result<usize> {
        let mut overlapped = Overlapped {
            internal: 0,
            internal_high: 0,
            offset: 0,
            offset_high: 0,
            event,
        };
        if operation(&raw mut overlapped) == 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(ERROR_IO_PENDING) {
                return Err(error);
            }
        }
        let mut transferred = 0u32;
        // SAFETY: `overlapped` describes the operation just started on this handle and outlives the wait.
        if unsafe { GetOverlappedResult(self.0, &mut overlapped, &mut transferred, 1) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(transferred as usize)
    }
}

impl Drop for Pipe {
    fn drop(&mut self) {
        // SAFETY: the handle came from CreateFileW and is closed exactly once.
        unsafe { CloseHandle(self.0) };
    }
}

fn connect(name: &str, openvmm: &mut Child) -> Result<Pipe, RuntimeHostError> {
    let path: Vec<u16> = format!(r"\\.\pipe\{name}")
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let deadline = Instant::now() + PIPE_CONNECT_TIMEOUT;
    loop {
        // SAFETY: `path` is NUL-terminated UTF-16; there are no security attributes or template file.
        let handle = unsafe {
            CreateFileW(
                path.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                0,
                null(),
                OPEN_EXISTING,
                FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION,
                null_mut(),
            )
        };
        if handle != INVALID_HANDLE_VALUE {
            return Ok(Pipe(handle));
        }
        let error = io::Error::last_os_error();
        let not_created_yet = matches!(
            error.raw_os_error(),
            Some(ERROR_FILE_NOT_FOUND | ERROR_PIPE_BUSY)
        );
        let exited = matches!(openvmm.try_wait(), Ok(Some(_)));
        if !not_created_yet || exited || Instant::now() >= deadline {
            return Err(runtime(format!(
                "Could not connect to the VM channel {name}: {error}."
            )));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn new_event() -> *mut c_void {
    // SAFETY: an unnamed manual-reset event without security attributes.
    let event = unsafe { CreateEventW(null(), 1, 0, null()) };
    assert!(
        !event.is_null(),
        "CreateEventW failed: {}",
        io::Error::last_os_error()
    );
    event
}

fn copy_to_output(pipe: &Pipe, mut output: impl Write) {
    let event = new_event();
    let mut buffer = vec![0u8; 64 * 1024];
    let length = u32::try_from(buffer.len()).expect("buffer length fits in u32");
    loop {
        let pointer = buffer.as_mut_ptr();
        // SAFETY: `pointer` is valid for `length` bytes and outlives the operation.
        let read = pipe.transfer(event, |overlapped| unsafe {
            ReadFile(pipe.0, pointer, length, null_mut(), overlapped)
        });
        let count = match read {
            Ok(0) | Err(_) => return,
            Ok(count) => count,
        };
        if output
            .write_all(&buffer[..count])
            .and_then(|()| output.flush())
            .is_err()
        {
            return;
        }
    }
}

// Known limit: the agent never sees end-of-input; the desktop app stops the helper instead.
fn copy_stdin_to(pipe: &Pipe) {
    let event = new_event();
    let mut input = io::stdin().lock();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let count = match input.read(&mut buffer) {
            Ok(0) | Err(_) => return,
            Ok(count) => count,
        };
        let mut sent = 0;
        while sent < count {
            let chunk = &buffer[sent..count];
            let length = u32::try_from(chunk.len()).expect("chunk length fits in u32");
            // SAFETY: `chunk` is valid for `length` bytes and outlives the operation.
            let written = pipe.transfer(event, |overlapped| unsafe {
                WriteFile(pipe.0, chunk.as_ptr(), length, null_mut(), overlapped)
            });
            match written {
                Ok(0) | Err(_) => return,
                Ok(written) => sent += written,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forwarded_guest_ports_are_read_from_every_entry() {
        assert_eq!(
            forwarded_guest_ports(
                "hostfwd=tcp:127.0.0.1:1455-:1455,hostfwd=tcp:[::1]:1455-:1455"
            ),
            vec![1455],
            "the same guest port forwarded for IPv4 and IPv6 is relayed once"
        );
        assert_eq!(
            forwarded_guest_ports("hostfwd=tcp::8123-10.0.0.2:8080,hostfwd=tcp::1455-:1455"),
            vec![1455, 8080],
            "a guest port differing from the host port, and several agents' ports, are all relayed"
        );
        assert!(forwarded_guest_ports("nonsense").is_empty());
    }

    #[test]
    fn run_input_rules_and_exit_code_report() {
        assert_eq!(numeric_user("10000:10000").unwrap(), (10000, 10000));
        for user in ["radius", "10000", "+1:2", "1:", ":1", "1:2:3"] {
            assert!(numeric_user(user).is_err(), "{user}");
        }
        assert!(is_safe_container_id("agent_example1-3f2a.b"));
        for id in ["", ".", "..", "a/b", r"a\b", "a:b"] {
            assert!(!is_safe_container_id(id), "{id}");
        }

        let log = std::env::temp_dir().join(format!("radius-boot-{}.log", random_uuid()));
        let report = |text: &str| {
            fs::write(&log, text).unwrap();
            agent_exit_code(&log, 0)
        };
        assert_eq!(
            report("[    1.0] kernel\r\nRADIUS-VMINIT: starting\r\nRADIUS-VMINIT: agent-exit code=7\r\n")
                .unwrap(),
            7
        );
        let error = report(
            "RADIUS-VMINIT: error: agent must run as a non-root user\nRADIUS-VMINIT: agent-exit code=255\n",
        )
        .unwrap_err();
        assert!(error.message().contains("non-root user"), "{error}");
        assert!(report("[    1.0] Kernel panic - not syncing\n").is_err());
        fs::remove_file(&log).ok();
    }

    #[test]
    fn removes_only_old_leftover_run_files_and_keeps_logs() {
        let containers = std::env::temp_dir().join(format!("radius-containers-{}", random_uuid()));
        let old_run = containers.join("old-run");
        let new_run = containers.join("new-run");
        let names = ["writable.ext4", "initrd.cpio", "boot.log"];
        for run in [&old_run, &new_run] {
            fs::create_dir_all(run).unwrap();
            for name in names {
                fs::write(run.join(name), b"x").unwrap();
            }
        }
        let an_hour_ago = std::time::SystemTime::now() - Duration::from_secs(3600);
        for name in names {
            fs::File::options()
                .write(true)
                .open(old_run.join(name))
                .unwrap()
                .set_modified(an_hour_ago)
                .unwrap();
        }

        remove_leftover_run_files(&containers);

        assert!(!old_run.join("writable.ext4").exists());
        assert!(!old_run.join("initrd.cpio").exists());
        assert!(old_run.join("boot.log").exists(), "logs are kept");
        assert!(
            new_run.join("writable.ext4").exists(),
            "recent run files are kept"
        );
        assert!(new_run.join("initrd.cpio").exists());
        fs::remove_dir_all(&containers).ok();
    }

    #[test]
    fn keeps_only_the_newest_finished_runs() {
        let containers = std::env::temp_dir().join(format!("radius-containers-{}", random_uuid()));
        let now = std::time::SystemTime::now();
        for index in 0..KEPT_RUNS + 3 {
            let run = containers.join(format!("run-{index}"));
            fs::create_dir_all(&run).unwrap();
            fs::write(run.join("boot.log"), b"x").unwrap();
            fs::File::options()
                .write(true)
                .open(run.join("boot.log"))
                .unwrap()
                .set_modified(now - Duration::from_secs(60 * index as u64))
                .unwrap();
        }
        let running = containers.join("running");
        fs::create_dir_all(&running).unwrap();
        fs::write(running.join("writable.ext4"), b"x").unwrap();
        fs::write(running.join("boot.log"), b"x").unwrap();
        fs::File::options()
            .write(true)
            .open(running.join("boot.log"))
            .unwrap()
            .set_modified(now - Duration::from_secs(86_400))
            .unwrap();

        remove_old_runs(&containers);

        assert!(containers.join(format!("run-{}", KEPT_RUNS - 1)).exists());
        assert!(!containers.join(format!("run-{KEPT_RUNS}")).exists());
        assert!(!containers.join(format!("run-{}", KEPT_RUNS + 2)).exists());
        assert!(running.exists(), "a running VM's folder is never deleted");
        fs::remove_dir_all(&containers).ok();
    }
}
