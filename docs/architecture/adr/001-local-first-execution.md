# ADR-001: Execute agents locally

**Status:** Accepted  
**Date:** 2026-08-20

## Context

Browser-hosted agents do not have first-class access to user-selected files, local command-line tools, operating-system notifications, artifact storage, or low-latency repeatable operations. Keeping every agent session in a dedicated remote sandbox also creates infrastructure and state-management overhead for vendors.

## Decision

Radius will run compatible agent packages on the user's computer. The desktop host owns:

- Agent package and process lifecycle.
- Permission and capability brokering.
- User-selected file access.
- Local command and MCP execution.
- Session history, artifacts, and runtime state.
- Health checks, audit events, and cancellation.

Agents may still call vendor services, authorized remote data, and model providers. Local execution does not move vendor authorization or proprietary data to the desktop by default.

When the desktop is unavailable, local agents are unavailable. Always-on cloud execution is a separate product concern and is not part of the Radius runtime contract.

## Options considered

### Local-first execution

**Advantages**

- Places execution close to user files and desktop tools.
- Reduces remote sandbox requirements for compatible workloads.
- Enables a responsive, observable desktop experience.

**Costs**

- Requires secure packaging, installation, isolation, updates, and endpoint support.
- Availability follows the user's computer.
- Enterprise environments may restrict virtualization or local commands.

### Remote agent with a desktop viewer

This preserves centralized operations but retains remote execution cost and requires a separate bridge for local capabilities. It remains compatible through an adapter, but it is not the primary Radius architecture.

### Local execution with automatic cloud fallback

Rejected for the initial architecture. Two interchangeable runtimes would duplicate state synchronization, debugging, permissions, and security policy before the local contract is proven.

## Consequences

- Desktop availability is part of the product contract.
- Endpoint security and understandable permissions are core features.
- Agent packages and the desktop application require independent signing and update chains.
- A future cloud fallback requires a separate decision record.

## Validation

1. Run representative agent workflows on ordinary supported computers.
2. Measure startup time, latency, memory, reliability, and installation burden.
3. Verify that vendor authorization remains server-enforced.
4. Test capability requests against the security model.
5. Validate managed-device constraints before promising enterprise compatibility.
