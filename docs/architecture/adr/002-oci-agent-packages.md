# ADR-002: Package local agents as signed OCI images in workspace-owned microVMs

**Status:** Accepted
**Date:** 2026-08-24
**Deciders:** Radius maintainers

## Context

The initial agent uses Python and TypeScript with dependencies that may include
native libraries, browser tooling, and command-line programs. Agent vendors
need one portable package without asking users to install or operate Docker
Desktop, Podman, Homebrew, or another container product.

Linux OCI images provide broad compatibility with that stack. On macOS, those
images require a Linux kernel and a virtualization boundary. A shared external
container runtime would simplify early development, but it would make
installation, lifecycle, updates, filesystem exposure, and recovery depend on
software outside the Radius trust and release boundary.

The first Radius release is intentionally narrower than the eventual
cross-platform product: Apple Silicon on macOS 26 or newer.

## Decision

Radius will ship a self-contained macOS runtime host based on Apple's
Containerization Swift package and `Virtualization.framework`.

- Link an exact reviewed Containerization release into a signed native Radius
  helper. The initial pin is `0.41.0`.
- Run every installed agent image in its own lightweight Linux VM.
- Prefer native `linux/arm64` images. A verified digest-pinned `linux/amd64`
  partner image may opt into Rosetta translation on Apple Silicon while its
  native image is prepared; Radius never enables translation implicitly.
- Use direct per-VM NAT or no network. Do not require the privileged shared
  vmnet helper or the restricted `com.apple.vm.networking` entitlement.
- Carry agent protocol frames through process standard input and output over
  the VM transport. Do not expose a container-engine socket or host callback
  port.
- Store OCI content, VM filesystems, writable overlays, logs, and runtime assets
  only beneath Radius-owned application data.
- Do not mount the user's home directory or project root into the VM. The host
  capability broker transfers bounded inputs and executes approved host tools.
- Treat the native helper, guest runtime assets, and agent packages as separate
  signed release surfaces.
- Add Windows through a future backend behind the same public runtime contract;
  do not delay the first macOS implementation on a shared lowest-common-denominator
  VM manager.

The bundled helper requires `com.apple.security.virtualization` and must be
Developer ID signed and notarized with the application. It must not request
administrator privileges during normal installation or execution.

## Agent package

Each published version contains:

```text
agent release
├── linux/arm64 OCI image
├── optional linux/amd64 compatibility image
├── capability manifest
├── compatibility metadata
├── software-bill-of-materials attestation
├── provenance attestation
└── publisher signature
```

Example manifest:

```json
{
  "protocolVersion": "1",
  "minimumHostVersion": "1.0.0",
  "entrypoint": ["/agent/start", "--stdio"],
  "toolInterfaces": [
    {
      "kind": "radius.mcp",
      "requirement": "optional",
      "declaration": "manifest",
      "protocolVersions": ["2026-07-28"]
    }
  ],
  "capabilities": [
    {
      "key": "workspace.files",
      "operation": "read",
      "requirement": "required"
    },
    {
      "key": "workspace.files",
      "operation": "write",
      "requirement": "required"
    },
    { "key": "shell", "operation": "execute", "requirement": "required" },
    { "key": "presentations", "operation": "create", "requirement": "optional" }
  ],
  "networkAllowlist": ["api.vendor.example", "api.openai.com"],
  "resources": {
    "cpu": 2,
    "memoryMb": 4096,
    "diskMb": 5120
  }
}
```

The manifest requests capabilities. It does not grant them. The host resolves
requests against provider availability, organization policy, user consent, and
the current task scope.

An agent provider declares support for Radius-managed MCP connectors either in
the signed manifest or by selecting `runtime_discovery`, which makes Radius run
a bounded interface probe while staging the exact signed release. Runtime
discovery is a request surface, not authority: every reported capability still
passes the same connector availability, schema, policy, and approval checks.

`required` and `optional` control product availability. Radius presents an
agent as selectable for a task only when every required interface and
capability has a compatible ready provider on that computer. Missing optional
connector capabilities do not hide the agent; Radius simply omits those tools.

## Runtime release surfaces

### Radius application

The Electron application, native runtime helper, and host protocol
implementation are signed and updated by the Radius distributor. A native
helper change requires an application update because nested executable code is
part of the signed application bundle.

### Guest runtime assets

The Linux kernel, init filesystem, and guest helper are selected by a
versioned Radius asset manifest. A compatible initial set ships with, or is
prepared by, Radius without an external installer. Later asset-only updates may
be downloaded to Radius application data after signature and digest
verification. The previous compatible asset set remains available for
rollback.

### Agent packages

An agent provider publishes a signed desired image digest and compatibility
range. Radius, not the provider, performs installation:

1. Resolve the immutable platform-specific image digest.
2. Verify publisher identity, signature, provenance, SBOM, and compatibility.
3. Compare the new capability manifest with the installed release.
4. Require approval for first installation or expanded capabilities.
5. Download only missing OCI layers into the Radius content store.
6. Stage the candidate in a fresh microVM and run protocol and health checks.
7. Activate it for new runs while existing runs remain pinned to their starting
   digest.
8. Retain the previous known-good digest and state checkpoint for rollback.

A provider can publish or revoke desired state, but cannot write executable
host code, bypass Radius policy, or silently expand its authority.

Agent and application updates may ship independently when compatibility ranges
overlap. A coordinated release declares a newer minimum host or guest-runtime
version; Radius stages the agent and activates it only after the compatible
platform release is installed.

### Bundled internal-agent bootstrap

A managed or white-label Radius distribution may include one or more internal
agent releases as bootstrap desired state. The application bundle contains a
validated `agents/index.json`; each entry maps one stable Platform project to a
relative OCI layout inside the signed application resources. The OCI image
configuration carries the canonical Radius release template as hashed metadata;
the external index cannot assign a different version or capability manifest to
the same image.

On launch, Radius:

1. validates the index and rejects duplicate project identities or escaping
   resource paths;
2. verifies the OCI manifest and configuration blobs by size and SHA-256;
3. reads the embedded release template and requires its version and image
   reference to match the hashed OCI configuration;
4. imports the packaged OCI layout into Radius-owned image storage and resolves
   its exact manifest digest;
5. stores the complete verified descriptor under its content hash, then
   atomically selects it under the project identity; and
6. exposes the delivered agent before any optional or required account sign-in.

One image digest identifies one release. A candidate that claims different
release metadata for an already-known digest is rejected, and Radius retains
the last valid installed descriptor rather than making the agent unavailable.

Authentication requirements belong to the signed release. A Sign in action
satisfies one requirement for an already-delivered agent; it does not install,
discover, or select an arbitrary agent package.

The bundled index is a bootstrap and offline-install surface, not a marketplace
or a second deployment authority. When Platform assignment and signed desired
state are available, the same project/release identity reconciles through the
normal deployment path. Application-bundled releases remain immutable inputs
and cannot bypass capability review, revocation, or a newer organization
assignment.

## Implemented local-alpha slice

The current public implementation validates a credential-free, digest-pinned
release descriptor and launches the native helper from Electron through
`packages/runtime`. The sidecar speaks stable ACP v1 over stdin/stdout, streams
agent updates, handles cancellation, and leaves persistence to the Electron
host. The sandboxed renderer can list configured agents and start or cancel a
prompt only through the narrow preload contract.

This slice intentionally uses explicit developer environment paths. It does
not implement publisher signature verification, a provider release channel,
encrypted installation state, staged activation, rollback, revocation, or the
host capability broker. Those remain required before distribution.

## Size and resource policy

V1 limits:

- Target image download: at most 1 GB compressed.
- Hard image limit: 2 GB compressed.
- Unpacked read-only root limit: 5 GB.
- Default persistent writable overlay: 5 GB per agent.
- Default runtime allocation: 2 CPU cores and 4 GB memory.
- Default process limit: 256.
- Default open-file limit: 1,024.

Images cannot be unlimited. Large packages slow installation, updates,
rollback, and incident remediation. Common layers should be shared in the OCI
content store, and updates should pull only changed layers.

The workspace provides browser automation as a host capability. Vendors do not
ship separate Chromium installations unless an approved integration genuinely
requires one.

## Runtime hardening

- Run the agent as a non-root user.
- Use a read-only image root and a dedicated writable ext4 overlay.
- Set `no-new-privileges`.
- Start with empty Linux capability sets.
- Apply CPU, memory, process, open-file, and disk limits.
- Never expose a container-engine socket, host PID namespace, privileged mode,
  or broad host mount.
- Allow outbound network access only according to resolved policy.
- Inject only short-lived scoped credentials at runtime; never bake secrets
  into image layers.
- Preserve bounded logs, health evidence, exact image and runtime digests, and
  cancellation history.

Per-agent microVMs are the default isolation unit, including for the first
trusted partner. Publisher verification, malware scanning, revocation, and
security response remain additional requirements before an untrusted public
catalog.

## Options considered

### Embedded Containerization with one microVM per agent

| Dimension                         | Assessment                            |
| --------------------------------- | ------------------------------------- |
| External installation             | None                                  |
| Python/TypeScript compatibility   | High through OCI images               |
| macOS isolation                   | Strong per-agent VM boundary          |
| Provider-controlled agent updates | Supported through signed OCI releases |
| Initial platform coverage         | Apple Silicon macOS 26 only           |
| Host implementation complexity    | High                                  |

Selected because installation, updates, trust, filesystem exposure, and
recovery remain inside the Radius product boundary.

### Workspace-managed Podman Machine

This supports macOS and Windows with familiar tooling, but it still requires a
large shared VM and Podman-specific installation and recovery behavior. Default
host mounts and the powerful engine API also require additional defensive
configuration. Rejected as the primary v1 runtime after choosing the
self-contained macOS target.

### Native application bundles

Rejected because vendors would need separate dependency and installer work per
platform, and Radius would lose a consistent Linux execution contract.

### WASM components

WASM may later support narrow plugins or transformations, but it does not cover
the current Python, native-library, browser, and shell requirements.

## Consequences

- Apple Silicon and macOS 26 are hard requirements for the first runtime.
- The Radius application must build, sign, notarize, package, and verify a
  Swift native helper carrying the virtualization entitlement.
- Radius owns kernel and init-image provenance, updates, disk pressure,
  runtime health, crash cleanup, and rollback.
- Agent installation and updates no longer require an application release when
  protocol compatibility is preserved.
- Windows support requires a separate future backend.
- Apple Containerization is fast-moving, so Radius pins exact versions and
  maintains packaged-app integration and recovery tests.

## Primary references

- [Apple Containerization](https://github.com/apple/containerization)
- [Apple Virtualization entitlement](https://developer.apple.com/documentation/virtualization/adding-the-virtualization-entitlement-to-your-project)
- [OCI image and distribution specifications](https://specs.opencontainers.org/)
- [Sigstore container signing](https://docs.sigstore.dev/cosign/signing/signing_with_containers/)
