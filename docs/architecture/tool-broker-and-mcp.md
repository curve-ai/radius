# Host tool broker and MCP integration

## Purpose

The tool broker gives vendor-owned agents local capabilities while preserving one permission, credential, event, and audit model.

```text
Vendor agent
    │ structured capability request
    ▼
Radius tool broker
    ├── capability manifest
    ├── user and task policy
    ├── interactive approval
    ├── credential injection
    ├── progress events
    └── audit record
         ├── local shell executor
         └── configured MCP connector
```

An agent package does not receive connector credentials, the container-engine socket, or unrestricted access to start host processes. The host configures and executes capabilities on its behalf.

## Shell execution

Local shell execution uses ACP's native client terminal methods rather than
MCP. Radius advertises `terminal` only when the active release requested
`shell.execute`, a project has at least one local source folder, and the macOS
executor is available. `terminal/create`, `terminal/output`,
`terminal/wait_for_exit`, `terminal/kill`, and `terminal/release` remain
host-owned operations over the existing ACP connection.

1. The agent proposes a command, working directory, purpose, and expected outputs.
2. Radius evaluates the request against the package manifest and current policy.
3. The workspace displays the exact action when approval is required.
4. The host executes the approved command inside the applicable sandbox.
5. Bounded output, exit status, duration, and resulting artifacts stream back to the session.
6. The request and decision remain in history.

The default production mode must restrict commands to an approved workspace and network policy. A clearly labelled developer mode may broaden access, but it must not silently bypass approvals.

On macOS, Radius runs terminal processes as the logged-in user beneath a
generated Seatbelt policy. Project source folders are the default readable and
writable roots. A command whose working directory is outside those roots can
run only after one-command approval; the approved directory is added only to
that command's frozen policy. Direct network access remains disabled.

ACP text-file methods follow the same rule. Reads inside project source folders
are available to releases requesting `workspace.files.read`; writes require
`workspace.files.write`. Exact paths outside the project pause for approval and
do not become durable project grants.

## MCP integration

MCP is one provider behind the tool broker rather than a parallel permission
system or the transport for Radius's local shell. The host:

- Configures and identifies trusted MCP servers.
- Namespaces tools by connector and server.
- Holds credentials in the operating-system credential store.
- Filters tools through package, organization, user, and task policy.
- Streams tool start, progress, result, and error events.
- Returns structured results without exposing credentials.
- Preserves provenance and audit history.

## Credential boundaries

- Agent packages receive only short-lived, scoped credentials required for approved services.
- Connector credentials remain in the host credential store.
- Model-provider credentials must not be baked into images.
- Tool output returns through structured events rather than shared process access.

## Failure behavior

- **Denied request:** return a structured denial so the agent can ask for an alternative.
- **Command failure:** return exit status and bounded stderr.
- **Connector unavailable:** fail visibly; do not fabricate a result.
- **Authorization expired:** request reauthentication through the host.
- **Invalid output:** preserve the tool result as invalid and require recovery.

## Deferred work

- Generic connector installation and discovery.
- Publisher trust and connector verification.
- Organization-managed connector catalogs.
- Automatic connector updates and rollback.
