# Security policy

Radius is pre-alpha and is not yet suitable for running untrusted agent packages. The documented isolation and permission model describes the intended boundary; not every control is implemented.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's **Report a vulnerability** flow in the Security tab of this repository so maintainers can coordinate a fix privately.

Include the affected commit, operating system, attacker-controlled input, permissions available to the attacker, expected boundary, observed behavior, and minimal reproduction steps. Remove live credentials, customer data, and unrelated local files.

## In scope

- Renderer-to-host privilege escalation.
- Permission or approval bypass.
- Filesystem or command execution outside the authorized scope.
- Credential exposure across agents, users, connectors, or logs.
- Agent package verification or update-chain failures.
- Container, VM, IPC, or local RPC boundary violations.
- Forged or incomplete audit, artifact, or tool results accepted as trusted.

Ordinary bugs and feature requests may use public GitHub issues.
