# ADR-009: Run Windows agents in per-agent microVMs with WHP and OpenVMM

**Status:** Accepted
**Date:** 2026-09-15
**Deciders:** Radius maintainers

## Context

ADR-002 chose Apple's Containerization and `Virtualization.framework` for the
first runtime host, on Apple Silicon macOS only, and deferred Windows to "a
future backend behind the same public runtime contract". Windows has no
equivalent of Apple's Containerization package, so a Windows backend needs its
own VM technology while keeping ADR-002's contract: the same
`doctor`/`load-image`/`run` commands, JSON reports and exit codes, the same
hardening rules, and no shared external container product.

## Decision

Radius will ship a self-contained Windows runtime host,
`apps/runtime-host-windows`, built in Rust on Microsoft's OpenVMM and the
built-in Windows Hypervisor Platform (WHP).

- Run every installed agent image in its own lightweight Linux VM.
- Start a separate, pinned `openvmm.exe` rather than embedding OpenVMM as a
  library. The build script refuses any other revision. Embedding it later
  changes nothing outside the helper.
- Prefer native `linux/amd64` images on Windows x64. There is no Rosetta
  equivalent, so Windows releases declare translation `native`; `none` and
  `rosetta` keep their macOS meaning.
- Use a private per-VM NAT (OpenVMM's consomme) or no network. No shared virtual
  switch or privileged networking service.
- Make `--port-forward` reach the agent's own `127.0.0.1` inside the guest, so
  an OAuth loopback sign-in works. The guest init relays each forwarded port; it
  is not specific to any agent.
- Carry agent protocol frames through the helper's standard input and output.
  Internally they cross a Windows named pipe to virtio-console; no TCP port is
  opened.
- Store OCI content, VM disks, logs and runtime assets only beneath Radius-owned
  application data.
- Do not mount the user's Windows drives into the VM. The developer-only state
  share is restricted to `%APPDATA%\Radius` and exposed with private permissions
  (0700 directories, 0600 files), because it carries credentials.
- Run each agent on two disks: a read-only code disk, built once per image digest
  in a short-lived builder VM with no network and then reused, and a fresh
  size-capped writable disk per run.
- Put the helper in a kill-on-close Job Object, so Windows guarantees that no VM
  outlives it, including after a hard kill, which is how the desktop app always
  stops it.
- Treat the native helper, guest runtime assets, and agent packages as separate
  signed release surfaces. The guest init and the builder program are compiled
  into the helper, so one signature covers all three.

The bundled helper must not require administrator rights during normal
installation or execution. WHP needs only the "Windows Hypervisor Platform"
optional feature, a one-time admin toggle outside Radius; it does not need
Hyper-V or an elevated process.

## Runtime hardening

The guest init, `radius-vminit`, applies ADR-002's hardening in an order where
each step still has the permission it needs:

1. process and open-file limits;
2. an empty capability bounding set and no ambient capabilities;
3. no supplementary groups, then the configured non-root group and user;
4. `no-new-privileges`.

The agent runs on an overlay of the read-only code disk and the writable disk,
the Windows equivalent of ADR-002's read-only image root with a writable ext4
overlay.

| Disk                  | Format | Why                                                     |
| --------------------- | ------ | ------------------------------------------------------- |
| Code disk (read-only) | erofs  | Read-only by construction, compact, and safe to reuse   |
| Writable disk         | ext4   | The same read-write file system ADR-002 uses on macOS   |

Both are written with pure-Rust crates (`am-fs-erofs`, `am-fs-ext4`), so the
build needs no Linux C cross-compiler and ships no GPL tool. The erofs writer
only runs inside a disposable builder VM.

## Options considered

### WHP with OpenVMM

| Dimension                  | Assessment                                     |
| -------------------------- | ---------------------------------------------- |
| External installation      | None beyond the one-time Windows feature       |
| Isolation model            | Our helper owns one VM per agent, as ADR-002   |
| Admin rights at run time   | None                                           |
| License                    | MIT                                            |
| Gap versus macOS           | No translation layer for foreign architectures |

Selected because it keeps each VM under the Radius helper's control, with no
admin prompt and no external product.

### WSL2

Rejected. WSL2 is one VM shared by every distribution on the machine, not a
per-agent boundary, and it mounts the Windows `C:\` drive by default.

### Docker Desktop or Podman

Rejected for the same reason ADR-002 rejected a shared external container
runtime: installation, lifecycle, updates and filesystem exposure would sit
outside the Radius trust and release boundary.

### Host Compute Service (HCS)

Rejected. Creating VMs or containers through HCS normally needs administrator
rights or a privileged local group.

### QEMU

Kept as a fallback only. It is a much larger dependency, and its GPL license
needs legal review before it could ship alongside a signed Radius binary.

## Consequences

- Windows x64 on Windows 11 is the first supported Windows target; Windows on
  ARM is not covered.
- The Radius application must build, sign and package two executables, the Rust
  helper and the pinned `openvmm.exe`, instead of one.
- Radius owns the pinned kernel, the guest programs and the OpenVMM revision on
  Windows, as ADR-002 assigns kernel and init-image provenance on macOS.
- The shared release schema has three translation values (`none`, `rosetta`,
  `native`); the macOS meaning of `rosetta` is unchanged.
- Restricting host commands an agent runs on the user's computer (the Windows
  equivalent of Seatbelt) remains a separate future decision.
- OpenVMM moves quickly, so Radius pins an exact revision and keeps VM
  integration tests.

## Primary references

- [ADR-002: Package local agents as signed OCI images in workspace-owned microVMs](002-oci-agent-packages.md)
- [Windows Hypervisor Platform](https://learn.microsoft.com/en-us/virtualization/api/)
- [OpenVMM](https://github.com/microsoft/openvmm)
- [OCI image and distribution specifications](https://specs.opencontainers.org/)
