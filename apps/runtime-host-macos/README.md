# Radius macOS runtime host

This package is the self-contained native execution boundary for Radius on
Apple Silicon Macs. It links the pinned Apple Containerization Swift package
and launches each OCI agent package in its own lightweight Linux VM through
`Virtualization.framework`.

It does not use or require Podman, Docker Desktop, Homebrew, a container-engine
socket, a shared Linux VM, or a privileged networking helper.

## Supported host

- Apple Silicon
- macOS 26 or newer
- A signed helper carrying `com.apple.security.virtualization`

The helper uses the per-VM `VZNATNetworkDeviceAttachment`. It does not request
the restricted `com.apple.vm.networking` entitlement.

## Commands

```bash
bun run runtime:build
bun run runtime:prepare-assets
bun run runtime:test
bun run runtime:doctor
```

`doctor` validates the host and the signed helper. `run` is the low-level
sidecar contract for a digest-pinned OCI agent image. Standard output is
reserved for the agent protocol, standard input carries host responses, and
helper failures are emitted as one JSON record on standard error.

`load-image --layout PATH --root PATH` imports a verified local OCI layout into
the Radius-owned image store and reports the stored references and descriptor
digests. The runtime accepts a locally imported tag for execution only when its
stored descriptor matches the exact requested digest.

The checked-in runtime asset manifest pins the guest init image and the
expected kernel archive digest. Release packaging downloads and verifies the
kernel at build time, then includes only the required kernel binary in the app.
The compatible guest init image is pulled into the Radius-owned OCI content
store on first preparation. Provider signature policy, release-channel
resolution, and atomic activation are the next implementation layer; the helper
never treats an agent image tag as immutable without an explicit developer
escape hatch.

## Security defaults

- one microVM per agent container;
- read-only image root with a dedicated writable ext4 overlay;
- non-root OCI user;
- no new privileges;
- empty Linux capability sets;
- bounded processes and open files;
- no host filesystem mounts;
- no container-engine socket;
- stdin/stdout protocol over the VM transport;
- direct per-VM NAT or no network.

Digest-pinned `linux/amd64` partner images may use the explicit `--rosetta`
compatibility mode on Apple Silicon. Radius does not enable translation for an
image unless its verified release metadata declares the amd64 platform.

The TypeScript release descriptor passes CPU, memory, root filesystem,
writable-state, process, and open-file limits explicitly to the helper. The
helper applies process and open-file limits as Linux rlimits inside the guest.

The manual integration spike also exposes `--developer-state-share`. It accepts
only an existing directory beneath Radius Application Support and shares it at
`/opt/data`; it exists to test a dedicated local credential state without
baking credentials into an image. Provider installations must replace it with
their encrypted ext4 state volume before distribution.

## Third-party software

Apple Containerization and its transitive packages retain their respective
licenses. See `THIRD_PARTY_NOTICES.md`. Release packaging must include those
notices and verify the entitlements of the nested helper after signing.
