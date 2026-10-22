# Radius Windows runtime host

This package is the self-contained native execution boundary for Radius on
Windows x64. It is a Rust helper, `radius-runtime-host.exe`, that launches each
OCI agent package in its own lightweight Linux VM through Microsoft's OpenVMM on
the built-in Windows Hypervisor Platform (WHP). The design decision is
[ADR-009](../../docs/architecture/adr/009-windows-runtime-host.md).

It does not use or require WSL, Hyper-V, Docker Desktop, Podman, a
container-engine socket, a shared Linux VM, or administrator rights at run time.

## Supported host

- x64 (Intel or AMD)
- Windows 11 (build 22000 or newer)
- The "Windows Hypervisor Platform" optional feature turned on (a one-time,
  admin-only toggle outside Radius)

## Commands

```powershell
bun run runtime:windows:build            # guest programs, helper, openvmm.exe check, signing, doctor
bun run runtime:windows:prepare-assets   # download and verify the pinned kernel
bun run agents:prepare:windows           # build the bundled agents (fx) for Windows
cargo test --manifest-path apps/runtime-host-windows/Cargo.toml
apps\runtime-host-windows\.build\release\radius-runtime-host.exe doctor --json
```

The helper implements the same command-line contract as the macOS helper.
`doctor` validates the host: x64, Windows 11, and that this process can create
a WHP partition. `run` starts a digest-pinned OCI agent image. Standard output
is reserved for the agent protocol, standard input carries host responses, and
helper failures are emitted as one JSON record on standard error.

`load-image --layout PATH --root PATH` imports a local OCI layout into the
Radius-owned image store, refusing any blob whose size or SHA-256 does not match
its descriptor, and reports the stored references and digests.

`Config/runtime-assets.json` pins the OpenVMM revision, the kernel archive
digest and the extracted kernel's digest. The prepare script verifies both
digests before writing `.build/runtime-assets/vmlinux-x64`. The build script
refuses an `openvmm.exe` whose `--version` does not show the pinned revision.
The two guest programs, `radius-vminit` (the guest init) and
`radius-rootfs-builder`, are compiled into the helper, so signing the helper
covers them.

## How a run works

- **Two disks.** A read-only erofs code disk, built once per image digest inside
  a short-lived builder VM with no network and cached as `rootfs\<hex>.erofs`,
  plus a new size-capped ext4 writable disk for each run. `radius-vminit` stacks
  them with overlayfs.
- **Channels.** Agent stdin/stdout cross a named pipe to virtio-console
  (`/dev/hvc0`); agent stderr uses a second pipe on COM2; the boot console (COM1)
  goes to `containers\<id>\boot.log`, which also carries the agent's exit code.
  No TCP port is opened.
- **Network.** OpenVMM's per-VM consomme NAT, or none with `--no-network`.
  `--port-forward` reaches the agent's own `127.0.0.1` inside the guest:
  `radius-vminit` relays each forwarded port, which an OAuth loopback sign-in
  needs.
- **Lifetime.** The helper joins a kill-on-close Job Object, so no VM outlives it,
  even after a hard kill. A later run deletes disks that hard-killed runs left
  behind once they are older than 10 minutes.

## Security defaults

- one microVM per agent container;
- read-only image root with a dedicated writable ext4 overlay;
- non-root numeric `uid:gid`;
- no new privileges;
- empty Linux capability sets;
- bounded processes and open files;
- no Windows drives mounted in the VM;
- no container-engine socket and no admin rights;
- stdin/stdout protocol over the VM transport;
- per-VM NAT or no network.

Windows agent images are `linux/amd64` with translation `native`. There is no
Rosetta equivalent, so `--rosetta` is refused, and a Mac refuses `native`.

The `--developer-state-share` flag accepts only an existing directory beneath
`%APPDATA%\Radius` (or a distribution's `%APPDATA%\Radius-<id>`) and shares it
at `/opt/data` through virtio-fs with private permissions (0700 directories,
0600 files).

## Developer setup

Building needs Rust (`rustup target add x86_64-unknown-linux-musl` for the guest
programs), the Visual Studio 2022 C++ Build Tools with the Windows SDK, and an
`openvmm.exe` built from the pinned revision (`cargo build -p openvmm` in an
OpenVMM checkout, after `cargo xflowey restore-packages --no-compat-igvm`).
Pass it to the build script with `-OpenVmmExe <path>`, and add
`-CertificateThumbprint <thumbprint>` to sign.

## Known limits

- The agent's stdio are terminal devices, so the agent never sees end-of-input;
  the desktop app stops the helper instead.
- No lock yet for two imports or code-disk builds of the same image at once.
- Hard links in an image become copies; extended attributes are not kept; only
  tar and tar+gzip layers are accepted.
- `/dev/pts` and `/dev/shm` are not mounted.
- Code signing has not been tried with a real certificate.

## Third-party software

OpenVMM (MIT), `am-fs-erofs` and `am-fs-ext4` (MIT) and the Kata Containers
kernel retain their respective licenses. A `THIRD_PARTY_NOTICES.md` still has to
be added and referenced from the Windows installer block before distribution.
