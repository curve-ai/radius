# ADR-003: Vendor owns the agent loop in v1

**Status:** Accepted  
**Date:** 2026-08-21  
**Deciders:** Radius maintainers

## Context

The platform must host mature domain agents that already own valuable integrations, database access, data semantics, skill permissions, and business workflows. The surrounding client is generic and expensive to build well.

The platform could either host the vendor's complete agent loop or replace it with one shared orchestrator that consumes vendor tools and data.

## Decision

In v1, the vendor package owns:

- Model selection and model-provider calls.
- Prompt construction and agent reasoning loop.
- Domain-specific tools and integrations.
- Database and data-access layer.
- Domain authorization, entitlements, and skill availability.
- Domain prompts, workflows, and evaluations.

The platform owns:

- Desktop UI, sessions, event rendering, history, and artifacts.
- Package and process lifecycle.
- Local state and task workspaces.
- Endpoint permissions and approval UX.
- Host-managed shell and MCP capabilities.
- Local file selection.
- Standard event and artifact protocol.

The platform will copy useful Codex security and interaction concepts but will not fork the Codex agent loop. A vendor-neutral host must not assume control of the vendor's model or reasoning implementation.

## Permission separation

Two independent policy layers apply:

- **Vendor authorization:** whether a user may access a tenant, account, dataset, domain workflow, or licensed skill.
- **Platform authorization:** whether an agent may read a local file, run a command, invoke an MCP tool, contact a network destination, or create an artifact.

Neither layer substitutes for the other.

## Future orchestration

A later platform orchestration agent may delegate tasks to multiple vendor-owned agents. Vendor agents remain independently owned loops and appear to the orchestrator through a typed task/result contract.

The future contract must support concepts such as:

- Start, observe, cancel, and resume a task.
- Structured progress and questions.
- Host capability requests.
- Artifacts, warnings, errors, and provenance.
- Explicit context references and requested output.
- User-approved data transfer between agents.

The detailed SDK schema is intentionally deferred until the single-agent runtime contract is validated.

## Options considered

### Vendor-owned loop

| Dimension | Assessment |
| --- | --- |
| Mature-agent adoption | High |
| Vendor autonomy | High |
| Integration speed | High |
| Cross-agent consistency | Lower |
| Platform control | Lower |

**Pros**

- Preserves vendor investment and domain behavior.
- Makes the platform an additive client/runtime rather than a rewrite.
- Allows vendors to choose models, prompts, and evaluation methods.

**Cons**

- Event and task behavior varies among vendors.
- Cross-agent orchestration requires a careful black-box contract.
- Platform cannot easily optimize or inspect every reasoning loop.

### Platform-owned loop with vendor tools

| Dimension | Assessment |
| --- | --- |
| Mature-agent adoption | Low to medium |
| Interoperability | High |
| Platform control | High |
| Vendor differentiation | Reduced |

This option may be appropriate for connector-only vendors or new agents built natively for the platform, but it is rejected as the sole v1 model.

### Support both models in v1

This option is rejected. It would double protocol, authentication, debugging, evaluation, and support complexity before the first vendor-owned loop is proven.

## Consequences

- V1 treats the vendor agent as a managed black box with structured events and capabilities.
- The platform must not depend on raw chain-of-thought.
- Progress should use plans, summaries, and typed tool events.
- Cross-agent orchestration remains a later product phase.
- The SDK task schema is a future design exercise rather than an alpha blocker.
