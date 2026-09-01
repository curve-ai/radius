# Radius local agent runtime

This package is the provider-neutral TypeScript sidecar between the Electron
main process and an agent running in a Radius-owned microVM.

It currently provides:

- a stable ACP v1 client based on `@agentclientprotocol/sdk` `1.4.0`;
- typed session initialization, prompt streaming, permission requests,
  cancellation, and shutdown;
- child-process stdin/stdout transport without a shell or callback port;
- validation for credential-free, digest-pinned agent release descriptors;
- explicit arm64 or amd64/Rosetta platform selection;
- ACP model discovery and exact session model selection;
- launch arguments for the signed macOS runtime helper;
- focused release, process, and ACP behavior tests.
- a validated bundled-agent index mapping internal Platform projects to OCI
  layouts whose hashed image configuration embeds the canonical Radius release
  template.

The Electron main process owns persistence and translates ACP updates into
canonical Radius events. The sandboxed renderer receives only the narrow
preload contract. This package does not read the Radius database, expose
credentials to the renderer, import Cloud code, or grant host capabilities.

## Development

From the Radius repository root:

```bash
bun run --cwd packages/runtime typecheck
bun run --cwd packages/runtime test
bun run --cwd packages/runtime build
```

The installed application will resolve release descriptors and state from a
verified release manager. During the local spike, the desktop accepts explicit
developer environment paths:

- `RADIUS_AGENT_RELEASE_PATH`
- `RADIUS_AGENT_RUNTIME_ROOT`
- `RADIUS_AGENT_DEVELOPER_STATE_SHARE`
- `RADIUS_RUNTIME_DEBUG=1`

The developer state share is accepted only by the native helper's guarded
development interface. It is not the distributed agent-state design.

`scripts/build-binary-agent-oci-layout.sh` produces a deterministic arm64 OCI
layout for a verified static agent binary. The native helper can import that
layout directly, so small provider packages do not require Docker or Podman in
the development or product execution path. Pass an explicit CA bundle as its
optional fifth argument when a scratch agent needs outbound TLS.

ACP category names are presentation hints, not unique configuration keys. fx,
for example, labels both its provider selector and model selector with category
`model`. Radius therefore prefers the exact standard config ID `model`, then a
category/name fallback, before applying `session/set_config_option`.

Packaged distributions place `agents/index.json` beside their agent resources.
Radius validates that index at launch, imports every listed OCI image, resolves
its exact digest, and records each release under the index's stable project
reference. Environment-variable release paths remain a developer override and
are not the packaged product path.

## Current limitations

- Each prompt starts a disposable microVM and ACP session.
- Follow-up context is replayed from canonical stored messages by the desktop.
- Ask-for-approval is fail-closed until the approval surface exists.
- Project access may choose only an ACP `allow_once` option for a requested
  operation.
- ACP terminal and text-file client adapters are implemented. The desktop may
  advertise them when the active release, project roots, and host policy allow;
  ordinary file attachments remain unconnected.
- Release signature verification, staged activation, rollback, and revocation
  remain release-manager work.
