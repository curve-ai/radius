use std::ffi::{CString, c_char, c_int, c_ulong};
use std::fs;
use std::io;
use std::net::{Shutdown, TcpListener, TcpStream};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use serde::Deserialize;

const CONFIG_PATH: &str = "/radius/config.json";
const AGENT_CONSOLE: &str = "/dev/hvc0";
const AGENT_ERRORS: &str = "/dev/ttyS1";
const DEFAULT_PATH: &str = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const CODE_MOUNT: &str = "/radius/code";
const WRITABLE_MOUNT: &str = "/radius/writable";
const NEW_ROOT: &str = "/radius/root";
const STATE_SHARE_TAG: &str = "radiusdata";
const STATE_SHARE_PATH: &str = "/opt/data";
const STATE_SHARE_STAGING: &str = "/.radius-state-share";
const NAMESERVER: &str = "10.0.0.1";
const GUEST_ADDRESS: &str = "10.0.0.2";

const PR_CAPBSET_DROP: c_int = 24;
const PR_SET_NO_NEW_PRIVS: c_int = 38;
const PR_CAP_AMBIENT: c_int = 47;
const PR_CAP_AMBIENT_CLEAR_ALL: c_ulong = 4;

const INIT_FAILURE: i32 = 255;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GuestConfig {
    schema_version: u32,
    arguments: Vec<String>,
    user: String,
    process_limit: u64,
    open_file_limit: u64,
    #[serde(default)]
    environment: Vec<String>,
    #[serde(default = "default_working_directory")]
    working_directory: String,
    #[serde(default)]
    allow_root: bool,
    #[serde(default)]
    network: bool,
    #[serde(default)]
    state_share: bool,
    #[serde(default)]
    loopback_ports: Vec<u16>,
}

fn default_working_directory() -> String {
    "/".to_owned()
}

struct AgentLaunch {
    program: CString,
    argv: Vec<CString>,
    envp: Vec<CString>,
    working_directory: CString,
    uid: libc::uid_t,
    gid: libc::gid_t,
    process_limit: libc::rlim_t,
    open_file_limit: libc::rlim_t,
    last_capability: c_int,
}

fn main() {
    println!("RADIUS-VMINIT: starting");
    let exit_code = match run() {
        Ok(exit_code) => exit_code,
        Err(message) => {
            println!("RADIUS-VMINIT: error: {message}");
            INIT_FAILURE
        }
    };
    println!("RADIUS-VMINIT: agent-exit code={exit_code}");
    power_off();
}

fn run() -> Result<i32, String> {
    mount_basics()?;
    let config = read_config()?;
    let console = open_raw(AGENT_CONSOLE)?;
    // Raw mode is on, so nothing echoes; the helper waits for this line before sending stdin.
    let mut ready = fs::File::from(
        console
            .try_clone()
            .map_err(|error| format!("dup {AGENT_CONSOLE}: {error}"))?,
    );
    io::Write::write_all(&mut ready, b"RADIUS-VMINIT-READY\n")
        .map_err(|error| format!("write to {AGENT_CONSOLE}: {error}"))?;
    drop(ready);
    let errors = open_raw(AGENT_ERRORS)?;
    enter_agent_root(&config)?;
    let launch = prepare_launch(&config)?;
    if config.state_share {
        stage_state_share(launch.uid, launch.gid)?;
    }
    println!(
        "RADIUS-VMINIT: starting agent {} as {}:{}",
        config.arguments[0], launch.uid, launch.gid
    );

    let argv: Vec<*const c_char> = launch
        .argv
        .iter()
        .map(|argument| argument.as_ptr())
        .chain(Some(std::ptr::null()))
        .collect();
    let envp: Vec<*const c_char> = launch
        .envp
        .iter()
        .map(|entry| entry.as_ptr())
        .chain(Some(std::ptr::null()))
        .collect();

    // SAFETY: single-threaded; the child only makes system calls on data prepared above.
    let pid = unsafe { libc::fork() };
    if pid < 0 {
        return Err(format!("fork failed: {}", io::Error::last_os_error()));
    }
    if pid == 0 {
        // SAFETY: freshly forked child; argv and envp are NULL-terminated and outlive this call.
        let exit_code = unsafe {
            start_agent(
                console.as_raw_fd(),
                errors.as_raw_fd(),
                &launch,
                &argv,
                &envp,
            )
        };
        // SAFETY: leave the child without running parent-owned destructors or atexit handlers.
        unsafe { libc::_exit(exit_code) };
    }

    drop(console);
    drop(errors);
    for port in &config.loopback_ports {
        start_loopback_relay(*port);
    }
    let exit_code = wait_for_agent(pid);
    if config.state_share {
        write_back_state_share();
    }
    Ok(exit_code)
}

/// OAuth callbacks bind 127.0.0.1, but the NAT delivers to GUEST_ADDRESS, so relay them.
fn start_loopback_relay(port: u16) {
    let listener = match TcpListener::bind((GUEST_ADDRESS, port)) {
        Ok(listener) => listener,
        Err(error) => {
            println!("RADIUS-VMINIT: port {port} relay could not listen: {error}");
            return;
        }
    };
    std::thread::spawn(move || {
        for client in listener.incoming().flatten() {
            std::thread::spawn(move || {
                if let Err(error) = relay(client, port) {
                    println!("RADIUS-VMINIT: port {port} relay failed: {error}");
                }
            });
        }
    });
}

fn relay(client: TcpStream, port: u16) -> io::Result<()> {
    let agent = TcpStream::connect(("127.0.0.1", port))
        .or_else(|_| TcpStream::connect(("::1", port)))?;
    let mut client_reader = client.try_clone()?;
    let mut agent_writer = agent.try_clone()?;
    let inbound = std::thread::spawn(move || {
        let _ = io::copy(&mut client_reader, &mut agent_writer);
        let _ = agent_writer.shutdown(Shutdown::Write);
    });
    let (mut agent_reader, mut client_writer) = (agent, client);
    let _ = io::copy(&mut agent_reader, &mut client_writer);
    let _ = client_writer.shutdown(Shutdown::Write);
    let _ = inbound.join();
    Ok(())
}

/// virtio-fs refuses O_TMPFILE, which fx needs, so the agent works on a copy.
/// Known limit: copies the whole tree both ways.
fn stage_state_share(uid: libc::uid_t, gid: libc::gid_t) -> Result<(), String> {
    copy_tree(Path::new(STATE_SHARE_STAGING), Path::new(STATE_SHARE_PATH))?;
    own_tree(Path::new(STATE_SHARE_PATH), uid, gid)
}

fn write_back_state_share() {
    if let Err(error) = sync_tree(Path::new(STATE_SHARE_PATH), Path::new(STATE_SHARE_STAGING)) {
        println!("RADIUS-VMINIT: state share write-back failed: {error}");
    }
}

fn copy_tree(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| format!("mkdir {}: {error}", target.display()))?;
    let entries =
        fs::read_dir(source).map_err(|error| format!("read {}: {error}", source.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("read {}: {error}", source.display()))?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        let kind = entry
            .file_type()
            .map_err(|error| format!("stat {}: {error}", from.display()))?;
        if kind.is_dir() {
            copy_tree(&from, &to)?;
        } else if kind.is_symlink() {
            let link = fs::read_link(&from)
                .map_err(|error| format!("readlink {}: {error}", from.display()))?;
            let _ = fs::remove_file(&to);
            std::os::unix::fs::symlink(&link, &to)
                .map_err(|error| format!("symlink {}: {error}", to.display()))?;
        } else {
            fs::copy(&from, &to)
                .map_err(|error| format!("copy {} to {}: {error}", from.display(), to.display()))?;
        }
    }
    Ok(())
}

fn sync_tree(source: &Path, target: &Path) -> Result<(), String> {
    copy_tree(source, target)?;
    let entries =
        fs::read_dir(target).map_err(|error| format!("read {}: {error}", target.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("read {}: {error}", target.display()))?;
        let name = entry.file_name();
        if source.join(&name).symlink_metadata().is_ok() {
            continue;
        }
        let stale = entry.path();
        let kind = entry
            .file_type()
            .map_err(|error| format!("stat {}: {error}", stale.display()))?;
        let removed = if kind.is_dir() {
            fs::remove_dir_all(&stale)
        } else {
            fs::remove_file(&stale)
        };
        removed.map_err(|error| format!("remove {}: {error}", stale.display()))?;
    }
    Ok(())
}

fn own_tree(path: &Path, uid: libc::uid_t, gid: libc::gid_t) -> Result<(), String> {
    let metadata = path
        .symlink_metadata()
        .map_err(|error| format!("stat {}: {error}", path.display()))?;
    let c_path = c_string(&path.to_string_lossy())?;
    // SAFETY: NUL-terminated path; lchown never follows the final symlink.
    if unsafe { libc::lchown(c_path.as_ptr(), uid, gid) } != 0 {
        return Err(format!(
            "chown {}: {}",
            path.display(),
            io::Error::last_os_error()
        ));
    }
    if metadata.is_symlink() {
        return Ok(());
    }
    let mode = if metadata.is_dir() { 0o700 } else { 0o600 };
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
        .map_err(|error| format!("chmod {}: {error}", path.display()))?;
    if metadata.is_dir() {
        let entries =
            fs::read_dir(path).map_err(|error| format!("read {}: {error}", path.display()))?;
        for entry in entries {
            let entry = entry.map_err(|error| format!("read {}: {error}", path.display()))?;
            own_tree(&entry.path(), uid, gid)?;
        }
    }
    Ok(())
}

fn mount_basics() -> Result<(), String> {
    let mounts: [(&str, &str, &str, c_ulong); 3] = [
        (
            "proc",
            "/proc",
            "proc",
            libc::MS_NOSUID | libc::MS_NODEV | libc::MS_NOEXEC,
        ),
        (
            "sysfs",
            "/sys",
            "sysfs",
            libc::MS_NOSUID | libc::MS_NODEV | libc::MS_NOEXEC,
        ),
        (
            "devtmpfs",
            "/dev",
            "devtmpfs",
            libc::MS_NOSUID | libc::MS_NOEXEC,
        ),
    ];
    for (source, target, filesystem, flags) in mounts {
        fs::create_dir_all(target).map_err(|error| format!("mkdir {target}: {error}"))?;
        let source_c = c_string(source)?;
        let target_c = c_string(target)?;
        let filesystem_c = c_string(filesystem)?;
        // SAFETY: all strings are NUL-terminated and no mount data is passed.
        let result = unsafe {
            libc::mount(
                source_c.as_ptr(),
                target_c.as_ptr(),
                filesystem_c.as_ptr(),
                flags,
                std::ptr::null(),
            )
        };
        if result != 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::EBUSY) {
                return Err(format!("mount {filesystem} on {target}: {error}"));
            }
        }
    }
    Ok(())
}

fn read_config() -> Result<GuestConfig, String> {
    let text =
        fs::read_to_string(CONFIG_PATH).map_err(|error| format!("read {CONFIG_PATH}: {error}"))?;
    let config: GuestConfig =
        serde_json::from_str(&text).map_err(|error| format!("parse {CONFIG_PATH}: {error}"))?;
    if config.schema_version != 1 {
        return Err(format!(
            "unsupported {CONFIG_PATH} schemaVersion {}",
            config.schema_version
        ));
    }
    Ok(config)
}

fn enter_agent_root(config: &GuestConfig) -> Result<(), String> {
    let (code_disk, writable_disk) = find_disks()?;
    let upper = format!("{WRITABLE_MOUNT}/upper");
    let work = format!("{WRITABLE_MOUNT}/work");

    for directory in [CODE_MOUNT, WRITABLE_MOUNT, NEW_ROOT] {
        fs::create_dir_all(directory).map_err(|error| format!("mkdir {directory}: {error}"))?;
    }
    mount_filesystem(
        &code_disk,
        CODE_MOUNT,
        "erofs",
        libc::MS_RDONLY | libc::MS_NODEV,
        None,
    )?;
    mount_filesystem(
        &writable_disk,
        WRITABLE_MOUNT,
        "ext4",
        libc::MS_NOSUID | libc::MS_NODEV,
        None,
    )?;
    for directory in [&upper, &work] {
        fs::create_dir_all(directory).map_err(|error| format!("mkdir {directory}: {error}"))?;
    }
    mount_filesystem(
        "overlay",
        NEW_ROOT,
        "overlay",
        libc::MS_NOSUID | libc::MS_NODEV,
        Some(&format!(
            "lowerdir={CODE_MOUNT},upperdir={upper},workdir={work}"
        )),
    )?;

    if config.state_share {
        let staging = format!("{NEW_ROOT}{STATE_SHARE_STAGING}");
        fs::create_dir_all(&staging).map_err(|error| format!("mkdir {staging}: {error}"))?;
        let state = format!("{NEW_ROOT}{STATE_SHARE_PATH}");
        fs::create_dir_all(&state).map_err(|error| format!("mkdir {state}: {error}"))?;
        mount_filesystem(
            STATE_SHARE_TAG,
            &staging,
            "virtiofs",
            libc::MS_NOSUID | libc::MS_NODEV,
            None,
        )?;
    }

    switch_root(NEW_ROOT)?;
    mount_basics()?;
    write_name_files(config.network)
}

fn find_disks() -> Result<(String, String), String> {
    let mut code = None;
    let mut writable = None;
    let entries =
        fs::read_dir("/sys/block").map_err(|error| format!("list /sys/block: {error}"))?;
    for entry in entries {
        let name = entry
            .map_err(|error| format!("list /sys/block: {error}"))?
            .file_name()
            .to_string_lossy()
            .into_owned();
        if !name.starts_with("vd") {
            continue;
        }
        let flag_path = format!("/sys/block/{name}/ro");
        let flag =
            fs::read_to_string(&flag_path).map_err(|error| format!("read {flag_path}: {error}"))?;
        let (slot, kind) = if flag.trim() == "1" {
            (&mut code, "read-only")
        } else {
            (&mut writable, "writable")
        };
        if slot.replace(format!("/dev/{name}")).is_some() {
            return Err(format!("more than one {kind} disk is attached"));
        }
    }
    Ok((
        code.ok_or("the read-only code disk is missing")?,
        writable.ok_or("the writable disk is missing")?,
    ))
}

fn mount_filesystem(
    source: &str,
    target: &str,
    filesystem: &str,
    flags: c_ulong,
    data: Option<&str>,
) -> Result<(), String> {
    let source_c = c_string(source)?;
    let target_c = c_string(target)?;
    let filesystem_c = c_string(filesystem)?;
    let data_c = data.map(c_string).transpose()?;
    // SAFETY: all strings are NUL-terminated and outlive the call.
    let result = unsafe {
        libc::mount(
            source_c.as_ptr(),
            target_c.as_ptr(),
            filesystem_c.as_ptr(),
            flags,
            data_c
                .as_ref()
                .map_or(std::ptr::null(), |data| data.as_ptr().cast()),
        )
    };
    if result != 0 {
        return Err(format!(
            "mount {filesystem} {source} on {target}: {}",
            io::Error::last_os_error()
        ));
    }
    Ok(())
}

/// An initramfs cannot pivot_root, so move the new root over it and chroot.
fn switch_root(new_root: &str) -> Result<(), String> {
    let new_root_c = c_string(new_root)?;
    let failed = |step: &str| format!("{step}: {}", io::Error::last_os_error());
    // SAFETY: plain system calls on NUL-terminated paths.
    unsafe {
        if libc::chdir(new_root_c.as_ptr()) != 0 {
            return Err(failed("chdir to the new root"));
        }
        if libc::mount(
            c".".as_ptr(),
            c"/".as_ptr(),
            std::ptr::null(),
            libc::MS_MOVE,
            std::ptr::null(),
        ) != 0
        {
            return Err(failed("move the new root to /"));
        }
        if libc::chroot(c".".as_ptr()) != 0 {
            return Err(failed("chroot"));
        }
        if libc::chdir(c"/".as_ptr()) != 0 {
            return Err(failed("chdir /"));
        }
    }
    Ok(())
}

fn write_name_files(network: bool) -> Result<(), String> {
    fs::create_dir_all("/etc").map_err(|error| format!("mkdir /etc: {error}"))?;
    if !Path::new("/etc/hosts").exists() {
        fs::write("/etc/hosts", "127.0.0.1 localhost\n::1 localhost\n")
            .map_err(|error| format!("write /etc/hosts: {error}"))?;
    }
    if network {
        let _ = fs::remove_file("/etc/resolv.conf");
        fs::write("/etc/resolv.conf", format!("nameserver {NAMESERVER}\n"))
            .map_err(|error| format!("write /etc/resolv.conf: {error}"))?;
    }
    Ok(())
}

fn prepare_launch(config: &GuestConfig) -> Result<AgentLaunch, String> {
    let program = config
        .arguments
        .first()
        .ok_or_else(|| "config arguments must name the agent program".to_owned())?;
    let (uid, gid) = parse_user(&config.user)?;
    if (uid == 0 || gid == 0) && !config.allow_root {
        return Err("agent must run as a non-root user".to_owned());
    }
    if config.process_limit == 0 || config.open_file_limit == 0 {
        return Err("processLimit and openFileLimit must be positive".to_owned());
    }
    for entry in &config.environment {
        if !entry.contains('=') || entry.starts_with('=') {
            return Err(format!("environment entry must be KEY=VALUE, got {entry}"));
        }
    }

    let mut environment = Vec::new();
    let search_path = match config
        .environment
        .iter()
        .find_map(|entry| entry.strip_prefix("PATH="))
    {
        Some(path) => path,
        None => {
            environment.push(format!("PATH={DEFAULT_PATH}"));
            DEFAULT_PATH
        }
    };
    environment.extend(config.environment.iter().cloned());

    Ok(AgentLaunch {
        program: c_string(&resolve_program(program, search_path)?)?,
        argv: config
            .arguments
            .iter()
            .map(|argument| c_string(argument))
            .collect::<Result<_, _>>()?,
        envp: environment
            .iter()
            .map(|entry| c_string(entry))
            .collect::<Result<_, _>>()?,
        working_directory: c_string(&config.working_directory)?,
        uid,
        gid,
        process_limit: config.process_limit,
        open_file_limit: config.open_file_limit,
        last_capability: read_last_capability()?,
    })
}

fn resolve_program(program: &str, search_path: &str) -> Result<String, String> {
    if program.starts_with('/') {
        return Ok(program.to_owned());
    }
    if program.contains('/') {
        return Err(format!(
            "agent program must be an absolute path or a name in PATH, got {program}"
        ));
    }
    search_path
        .split(':')
        .filter(|directory| directory.starts_with('/'))
        .map(|directory| format!("{directory}/{program}"))
        .find(|candidate| {
            fs::metadata(candidate).is_ok_and(|metadata| {
                metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
            })
        })
        .ok_or_else(|| format!("agent program {program} was not found in PATH {search_path}"))
}

fn parse_user(user: &str) -> Result<(libc::uid_t, libc::gid_t), String> {
    let invalid = || format!("user must be numeric uid:gid, got {user}");
    let (uid, gid) = user.split_once(':').ok_or_else(invalid)?;
    let parse = |value: &str| {
        if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(invalid());
        }
        value.parse::<u32>().map_err(|_| invalid())
    };
    Ok((parse(uid)?, parse(gid)?))
}

fn read_last_capability() -> Result<c_int, String> {
    let path = "/proc/sys/kernel/cap_last_cap";
    fs::read_to_string(path)
        .map_err(|error| format!("read {path}: {error}"))?
        .trim()
        .parse::<c_int>()
        .map_err(|error| format!("parse {path}: {error}"))
}

fn open_raw(device: &str) -> Result<OwnedFd, String> {
    let path = c_string(device)?;
    // SAFETY: valid path; O_NOCTTY and O_CLOEXEC keep it off init's terminal and out of the agent.
    let fd = unsafe {
        libc::open(
            path.as_ptr(),
            libc::O_RDWR | libc::O_NOCTTY | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(format!("open {device}: {}", io::Error::last_os_error()));
    }
    // SAFETY: `fd` was just opened and is owned by nothing else.
    let terminal = unsafe { OwnedFd::from_raw_fd(fd) };

    // SAFETY: `termios` is a plain C struct that tcgetattr fills in completely.
    let mut termios: libc::termios = unsafe { std::mem::zeroed() };
    // SAFETY: valid descriptor and out-pointer.
    if unsafe { libc::tcgetattr(terminal.as_raw_fd(), &mut termios) } != 0 {
        return Err(format!(
            "tcgetattr {device}: {}",
            io::Error::last_os_error()
        ));
    }
    // SAFETY: `termios` was initialised by tcgetattr.
    unsafe { libc::cfmakeraw(&mut termios) };
    // SAFETY: valid descriptor and settings.
    if unsafe { libc::tcsetattr(terminal.as_raw_fd(), libc::TCSANOW, &termios) } != 0 {
        return Err(format!(
            "tcsetattr {device}: {}",
            io::Error::last_os_error()
        ));
    }
    Ok(terminal)
}

/// # Safety
/// Must run in a freshly forked child of a single-threaded process; argv and envp are NULL-terminated.
unsafe fn start_agent(
    console: c_int,
    errors: c_int,
    launch: &AgentLaunch,
    argv: &[*const c_char],
    envp: &[*const c_char],
) -> i32 {
    fn failed(step: &str) -> i32 {
        eprintln!(
            "RADIUS-VMINIT: agent setup failed at {step}: {}",
            io::Error::last_os_error()
        );
        126
    }

    // SAFETY: guaranteed by the caller; only values prepared before the fork are used.
    unsafe {
        if libc::setsid() < 0 {
            return failed("setsid");
        }
        if libc::dup2(console, 0) < 0 || libc::dup2(console, 1) < 0 || libc::dup2(errors, 2) < 0 {
            return failed("dup2");
        }

        let limits = [
            (libc::RLIMIT_NOFILE, launch.open_file_limit),
            (libc::RLIMIT_NPROC, launch.process_limit),
        ];
        for (resource, limit) in limits {
            let value = libc::rlimit {
                rlim_cur: limit,
                rlim_max: limit,
            };
            if libc::setrlimit(resource, &value) != 0 {
                return failed("setrlimit");
            }
        }

        // Before changing user: emptying the bounding set needs CAP_SETPCAP.
        for capability in 0..=launch.last_capability {
            if libc::prctl(PR_CAPBSET_DROP, capability as c_ulong, 0, 0, 0) != 0 {
                return failed("PR_CAPBSET_DROP");
            }
        }
        if libc::prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0) != 0 {
            return failed("PR_CAP_AMBIENT");
        }

        // Change user last: it clears the remaining capabilities.
        if libc::setgroups(0, std::ptr::null()) != 0 {
            return failed("setgroups");
        }
        if libc::setgid(launch.gid) != 0 {
            return failed("setgid");
        }
        if libc::setuid(launch.uid) != 0 {
            return failed("setuid");
        }

        if libc::prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0 {
            return failed("PR_SET_NO_NEW_PRIVS");
        }

        if libc::chdir(launch.working_directory.as_ptr()) != 0 {
            return failed("chdir");
        }
        libc::execve(launch.program.as_ptr(), argv.as_ptr(), envp.as_ptr());
        failed("execve")
    }
}

fn wait_for_agent(agent: libc::pid_t) -> i32 {
    loop {
        let mut status: c_int = 0;
        // SAFETY: valid out-pointer.
        let pid = unsafe { libc::waitpid(-1, &mut status, 0) };
        if pid < 0 {
            if io::Error::last_os_error().kind() == io::ErrorKind::Interrupted {
                continue;
            }
            return INIT_FAILURE;
        }
        if pid != agent {
            continue;
        }
        return if libc::WIFEXITED(status) {
            libc::WEXITSTATUS(status)
        } else if libc::WIFSIGNALED(status) {
            128 + libc::WTERMSIG(status)
        } else {
            INIT_FAILURE
        };
    }
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

fn c_string(value: &str) -> Result<CString, String> {
    CString::new(value).map_err(|_| format!("value contains a NUL byte: {value:?}"))
}
