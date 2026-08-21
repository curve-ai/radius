# Radius architecture

Radius is a local-first desktop host for vendor-owned AI agents. The host provides a consistent user experience and mediates access to operating-system capabilities; agent vendors retain their models, prompts, domain tools, data services, and reasoning loops.

## System boundary

```text
Radius desktop
├── React renderer
│   └── sessions, approvals, progress, and artifacts
├── Electron host
│   └── windows, notifications, credentials, and signed IPC
├── capability broker
│   └── files, shell, MCP tools, and audit events
└── managed local runtime
    └── signed OCI agent package
        ├── vendor-owned agent loop
        └── structured capability requests
```

The React renderer is unprivileged. Electron owns operating-system integration but does not perform long-running agent work. Agent execution belongs in a supervised local runtime so CPU, filesystem, and container work cannot block the UI process.

## Accepted direction

- Execute agents locally when proximity to user files and tools is valuable.
- Package Python and TypeScript agents as signed, multi-architecture OCI images.
- Keep model selection and the reasoning loop vendor-owned.
- Expose host capabilities through a typed broker; never mount broad host resources directly into an agent container.
- Standardize events, capabilities, permissions, artifacts, cancellation, and provenance rather than agent personas.
- Keep the public protocol versioned and portable.

## Decision records

- [`adr/001-local-first-execution.md`](adr/001-local-first-execution.md) — execute the first agent on the user's desktop.
- [`adr/002-oci-agent-packages.md`](adr/002-oci-agent-packages.md) — distribute local agents as signed OCI images.
- [`adr/003-vendor-owned-agent-loop.md`](adr/003-vendor-owned-agent-loop.md) — preserve the vendor's agent loop.

## Supporting architecture

- [`security-model.md`](security-model.md) — trust boundaries, permissions, credentials, and runtime hardening.
- [`tool-broker-and-mcp.md`](tool-broker-and-mcp.md) — host-managed shell and MCP execution.

## Repository shape

```text
apps/desktop          Electron host and React renderer
packages/protocol     Versioned package and event contracts (planned)
packages/runtime      Supervised local agent runtime (planned)
packages/tool-broker  Capability policy and host tools (planned)
packages/sdk          Vendor integration SDK (planned)
docs/architecture     Public technical decisions
```

Business strategy, operated services, private integrations, and internal delivery plans are intentionally outside this repository.
