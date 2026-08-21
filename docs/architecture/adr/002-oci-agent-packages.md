# ADR-002: Package local agents as signed OCI images

**Status:** Proposed  
**Date:** 2026-08-20  
**Deciders:** Radius maintainers

## Context

The initial agent uses Python and TypeScript with dependencies that may include native libraries, browser tooling, and command-line programs. The package must run on both macOS and Windows without asking agent vendors to rewrite their stack.

Linux containers provide the broadest compatibility with that stack, but macOS and Windows require a Linux VM. The runtime must remain invisible to end users and cannot depend on a separately managed Docker Desktop installation.

## Decision

Vendors will publish signed, multi-architecture OCI images. The desktop workspace will run them inside a workspace-managed Podman Machine for v1.

- Publish `linux/arm64` and `linux/amd64` images under one OCI image index.
- Use Podman Machine's rootless Linux VM on macOS and Windows.
- Do not require users to install or operate Docker Desktop.
- Treat Podman as an implementation detail behind a workspace-owned runtime API.
- Revisit a thinner workspace-owned VM with `containerd` only after the first integration is validated.

Podman documents that macOS and Windows require a managed Linux VM and that Podman Machine is rootless. Docker Desktop is not selected because it is a separate product with license acceptance and paid commercial-use requirements for larger organizations.

## Agent package

Each published version contains:

```text
agent release
├── linux/arm64 OCI image
├── linux/amd64 OCI image
├── capability manifest
├── software-bill-of-materials attestation
├── provenance attestation
└── publisher signature
```

Example manifest:

```json
{
  "protocolVersion": "1",
  "entrypoint": ["/agent/start"],
  "rpcPort": 7321,
  "capabilities": [
    "workspace.files.read",
    "workspace.files.write",
    "browser.navigate",
    "shell.execute",
    "artifacts.create",
    "schedules.register"
  ],
  "networkAllowlist": [
    "api.vendor.example",
    "api.openai.com"
  ],
  "resources": {
    "cpu": 2,
    "memoryMb": 4096,
    "diskMb": 5120
  }
}
```

The manifest requests capabilities. It does not grant them. The host resolves requests against organization policy, user consent, and current task scope.

## Size and resource policy

V1 limits:

- Target image download: at most 1 GB compressed.
- Hard image limit: 2 GB compressed.
- Unpacked image limit: 5 GB.
- Default persistent state quota: 5 GB per agent.
- Default runtime allocation: 2 CPU cores and 4 GB memory.

Images cannot be unlimited. Large packages slow installation, updates, rollback, and incident remediation. Common base layers should be shared, and updates should pull only changed OCI layers.

The workspace should provide browser automation as a host capability. Vendors should not ship separate Chromium installations unless an approved integration genuinely requires one.

## Distribution and updates

Use an existing private OCI registry rather than building a registry.

1. Vendor CI builds both architectures.
2. Tests, dependency checks, and vulnerability scanning run.
3. Images are pushed by immutable digest.
4. CI signs the digest with Cosign and attaches provenance and SBOM attestations.
5. The workspace verifies publisher identity, signature, attestations, and digest before download or execution.
6. An update is staged and health-checked before activation.
7. The previous known-good digest remains available for rollback.

The workspace client itself and agent images have separate trust chains. Signing the desktop application does not make an unsigned agent image trustworthy.

## Runtime hardening

For the trusted single-agent pilot:

- Run the VM and containers rootlessly.
- Run the agent as a non-root user.
- Use a read-only root filesystem and dedicated writable state volume.
- Set `no-new-privileges`.
- Drop all Linux capabilities unless one is explicitly justified.
- Never use privileged containers, host PID namespace, or a mounted Podman/Docker socket.
- Apply seccomp policy and CPU, memory, process, and disk limits.
- Allow outbound network access only to declared and approved destinations.
- Mount only user-selected files through the host capability broker.
- Inject only short-lived scoped credentials at runtime; never bake secrets into image layers.

One rootless container in one managed VM is acceptable only for the trusted initial partner. A marketplace accepting mutually untrusted publishers will require stronger per-publisher isolation, likely separate microVMs or an equivalent hardened boundary.

## Options considered

### OCI image in a managed VM

| Dimension | Assessment |
| --- | --- |
| Python/TypeScript compatibility | High |
| Cross-platform support | High through a Linux VM |
| Isolation | Good for a trusted pilot; insufficient alone for an untrusted marketplace |
| Package complexity | Low for vendors |
| Host complexity | Medium to high |

### Native application bundles

| Dimension | Assessment |
| --- | --- |
| Python/TypeScript compatibility | Medium |
| Cross-platform support | Requires separate builds and installers |
| Isolation | Depends entirely on host sandboxing |
| Package complexity | High for vendors |

### WASM components

| Dimension | Assessment |
| --- | --- |
| Isolation | Strong |
| Python/native-library compatibility | Low for the current stack |
| Browser and shell compatibility | Low |
| Long-term potential | High for constrained extensions |

WASM may later support narrow plugins or UI/data transformations, but it is not the primary agent package for v1.

## Consequences

- The workspace installer must provision virtualization and runtime components without exposing Podman concepts to the user.
- Enterprise deployment may require IT or MDM approval.
- Proxy, private certificate, disk-pressure, runtime-health, and VM-recovery paths become product requirements.
- The first installation may consume approximately 5–10 GB including the base VM and agent image.
- Marketplace-grade isolation is explicitly deferred.

## Primary references

- [Podman Machine](https://docs.podman.io/en/stable/markdown/podman-machine.1.html)
- [Docker Desktop licensing](https://docs.docker.com/subscription/desktop-license/)
- [Docker rootless mode](https://docs.docker.com/engine/security/rootless/)
- [Docker Engine security](https://docs.docker.com/engine/security/)
- [OCI image indexes and architectures](https://docs.docker.com/docker-hub/repos/manage/hub-images/manage/)
- [Sigstore container signing](https://docs.sigstore.dev/cosign/signing/signing_with_containers/)
