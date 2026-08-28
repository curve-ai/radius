# Security and data-boundary model

## Security premise

Anything shipped to a user-controlled computer can be inspected, copied, modified, traced, or reverse engineered. Compilation, minification, signing, and obfuscation increase effort; they do not protect enduring secrets.

The platform must remain secure even when the local harness and vendor package are fully inspectable.

## Permission modes

The platform will copy Codex's security model rather than fork its harness or agent loop.

- **Read only:** inspect selected workspace data without mutation or command execution.
- **Auto:** read and write within the approved workspace; outside files, new network destinations, and elevated actions require approval.
- **Full access:** commands may use everything available to the logged-in OS user, subject to the approval policy and operating-system controls. The UI must identify this mode as elevated risk.

The permission mode and approval policy are separate controls. Full Access may still ask before every shell command.

Developer builds may expose Full Access for local testing. Distributed builds default to Auto, and organization policy may disable Full Access entirely.

### Current local-alpha enforcement

The first ACP desktop integration exposes Ask for approval and Full access in
the existing composer while the complete policy resolver is still under
review. Ask for approval currently cancels permission requests, so it fails
closed rather than simulating an approval. Full access may select only an ACP
`allow_once` option for the current operation. It never selects
`allow_always`, persists a remembered grant, or bypasses the future capability
broker. Distributed defaults remain governed by the policy above.

## Reference-product lesson

Leading coding agents do not depend on hiding the local harness:

- OpenAI publishes the Codex CLI, SDK, and App Server as open-source components. Codex protects command execution with sandbox modes, approval policy, workspace boundaries, and network controls.
- Claude Code ships local executable code but documents a permission layer plus OS-enforced filesystem and network isolation. Its macOS sandbox uses Seatbelt and its Linux sandbox uses bubblewrap.
- Cursor builds on the open-source VS Code foundation while routing AI requests through its backend for final prompt construction and service policy.

The reusable lesson is to separate an inspectable execution client from a privileged server-side control plane.

The platform copies these concepts and interaction patterns. It does not fork Codex's agent loop because v1 hosts a vendor-owned loop.

## Trust boundaries

```text
Untrusted or inspectable
├── vendor OCI image
├── model-generated commands
├── retrieved documents and web content
├── local cached data
└── desktop UI and imported input

Trusted enforcement
├── signed workspace host
├── capability and approval broker
├── OS and per-agent microVM isolation
├── image signature verification
├── scoped credential issuer
└── vendor authorization service
```

## Local package contents

The local package may contain:

- Agent orchestration code.
- Python and TypeScript runtimes and dependencies.
- Non-secret prompts, skills, and tool adapters.
- RPC and event protocol implementation.
- Local DuckDB schemas and query code.
- Artifact creation and transformation logic.

Do not place these in the image:

- Long-lived vendor or model-provider API keys.
- Master credentials.
- Cross-tenant authorization rules that depend on secrecy.
- Unencrypted customer exports.
- Private signing keys.
- Secrets in build arguments, environment defaults, or prior image layers.

## Server-side responsibilities

The vendor or platform control plane retains:

- Authentication, entitlements, device registration, and revocation.
- Mastered data that the vendor does not authorize for local storage.
- Server-enforced row, tenant, and field permissions.
- Short-lived credential issuance.
- Proprietary services or logic that genuinely must remain confidential.
- Audit evidence that the endpoint cannot rewrite.
- Server-side queries for data that is not authorized for local storage.

Model calls may go directly from the local runtime to a chosen provider, but the runtime should receive only a short-lived, user-scoped credential. A vendor gateway remains preferable when the vendor needs central budgets, policy, routing, redaction, or audit controls.

## Local data

A vendor may authorize a bounded working dataset for a local encrypted DuckDB or equivalent store.

Required controls:

- Explicit tenant and user binding.
- Minimal working set rather than an unrestricted master copy.
- Encryption at rest with keys stored in the operating-system credential store.
- Snapshot version, source provenance, and refresh time.
- Revocation and local deletion support.
- Export and artifact audit trail.
- Separate state per vendor and user.

Local data does not replace server authorization. The server decides what may be downloaded and issues bounded snapshots or query results.

## Capability broker

The agent container never receives unrestricted host access. It requests structured capabilities from the signed workspace host.

```text
Agent: shell.execute({ command, cwd, purpose })
  -> capability policy
  -> organization rule
  -> current user/task authorization
  -> approval when required
  -> sandboxed host execution
  -> bounded stdout/stderr/result
```

Apply the same pattern to files, browser control, notifications, schedules, and artifacts.

Hard prohibitions:

- No mounted container-engine socket.
- No privileged mode.
- No entire home-directory mount.
- No raw browser-profile mount.
- No unrestricted outbound network.
- No silent persistence outside declared state directories.
- No vendor-defined bypass of host approval policy.

## Credential flow

1. The user signs in through the workspace.
2. The workspace registers the device and agent package version.
3. The vendor issues a short-lived credential bound to user, device, agent, capabilities, and expiration.
4. The host injects it into volatile runtime memory or a temporary mount.
5. The agent calls approved vendor or model endpoints.
6. Revocation or logout prevents renewal and clears local credentials.

## Untrusted publisher escalation

A trusted package and a directory of mutually untrusted publishers have different threat models.

Every macOS agent package runs in a separate lightweight VM. Before accepting
untrusted publishers, also add:

- Publisher verification and incident-response requirements.
- Mandatory SBOM and provenance attestations.
- Automated malware and vulnerability scanning.
- Central kill switch and digest revocation.
- Capability review and least-privilege defaults.
- Security update SLAs.

## Primary references

- [OpenAI Codex open-source components](https://learn.chatgpt.com/docs/open-source)
- [Codex agent approvals and sandboxing](https://learn.chatgpt.com/docs/agent-approvals-security)
- [Claude Code security](https://code.claude.com/docs/en/security)
- [Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing)
- [Cursor privacy architecture](https://docs.cursor.com/account/privacy)
- [Cursor security](https://cursor.com/en-US/security)
