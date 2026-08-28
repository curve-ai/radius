# Platform jobs and provider boundary

**Status:** Durable local integration implemented
**Date:** 2026-08-25

## Requirements and constraints

Radius needs retryable background work for registry verification, deployment
rollouts, notifications, and maintenance. The same worker application must run
in a single-node self-host installation and in a managed multi-worker setup.

The initial constraints are:

- the API remains the authority for authentication, authorization, and product
  state;
- Redis is a delivery mechanism, not the source of truth;
- jobs must be idempotent and safe to retry;
- payloads must not contain passwords, tokens, or provider credentials;
- a worker may contact only explicitly allowlisted registries; and
- durable enqueue uses the approved PostgreSQL transactional outbox.

## High-level design

```text
developer CLI
      │ prepare / push / finalize
      ▼
Platform API ── authoritative write ──► PostgreSQL
      │
      └── IDs + digests + idempotency key
                    │
                    ▼
          transactional outbox
                    │
                    ▼
          dedicated Redis / BullMQ
                    │
                    ▼
           Platform jobs worker
                    │
            public provider contract
                    ▼
       self-host or managed registry
```

The public layers are:

- `@curve-ai/platform-job-contracts`: versioned names, payload schemas, and
  success-result schemas with no BullMQ dependency;
- `@curve-ai/platform-providers`: queue-independent external-effect contracts
  plus a generic OCI Distribution manifest verifier;
- `apps/platform-jobs`: the BullMQ adapter, worker lifecycle, environment-based
  provider composition, and operational smoke test; and
- `hosting/docker/compose.dev.yml`: a pinned Redis instance configured with AOF
  and `maxmemory-policy noeviction`.

Curve-operated registry, workload identity, autoscaling, and fleet adapters do
not belong in these layers. Cloud can implement the public provider contract or
operate the released worker with managed configuration.

## Initial contracts

`platform.healthcheck.v1` proves API/producer to Redis to worker delivery.
`agent_deployment.verify.v1` asks the worker to verify an already-uploaded OCI
manifest by its exact digest. Its payload contains organization, agent, and
agent-deployment identifiers, the image reference, expected digest, and an
idempotency key.

The worker resolves authorization from its provider configuration. The generic
Distribution provider rejects registries outside its allowlist, uses HTTPS by
default, permits loopback HTTP only with an explicit development flag, performs
a `HEAD` by digest, and rejects a mismatched registry digest.

Container networks may map a stored host-visible registry authority to a
worker-reachable internal endpoint. The mapping is explicitly configured,
does not rewrite the immutable deployment reference, and still requires separate
allowlist and insecure-transport opt-ins when HTTP is used.

The development stack has exercised both paths through a real pinned Redis
instance and worker. The healthcheck completed on the local worker. A real OCI
image pushed to the pinned development Distribution registry then completed a
`agent_deployment.verify.v1` job at exact digest
`sha256:fa647fc1e5d5df7d8d923fb6332aab8e78783f8fca1a1394efb4011f68f5a793`.
The smoke services were stopped afterward and their volumes retained.

The PostgreSQL development provider verifies the registry digest before
finalization, then commits the immutable verified deployment and an
`agent_deployment.verify.v1` outbox message in the same transaction. The jobs service
locks ready outbox rows with `SKIP LOCKED`, publishes them with the outbox UUID
as the deterministic BullMQ job ID, and marks publication in PostgreSQL. Live
clean-volume verification completed two exact-digest jobs and retained the
published records across an API restart.

## Reliability rules

- The API commits authoritative state before publishing follow-on work.
- The API and jobs service use the transactional outbox so a process crash
  cannot lose work between authoritative commit and enqueue.
- Every external effect uses a deterministic idempotency key; BullMQ job IDs
  should derive from it where duplicate suppression is required.
- Workers use bounded concurrency, exponential retry, graceful shutdown, and
  longer retention for failures than successes.
- The queue Redis is dedicated, persistent, and non-evicting.
- Terminal job failures become explicit product/audit state; logs alone are
  not a state machine.
- Registry credentials are worker-local or workload identities and never job
  data, job names, tags, or inspector metadata.

## Trade-offs

BullMQ adds Redis to the self-host stack, but gives predictable delayed work,
retry, concurrency, inspection, and horizontal workers without overloading
PostgreSQL. Keeping schemas independent from BullMQ prevents queue technology
from becoming part of the public product model.

Exact-digest verification is deliberately small. Signature policy, SBOM and
provenance validation, malware scanning, rollout reconciliation, revocation,
and notification jobs should be added only with explicit state transitions and
idempotency behavior.

## Revisit as the system grows

- worker result evidence and terminal-failure application beyond publication;
- registry bearer-challenge and cloud workload-identity adapters;
- per-job concurrency and tenant fairness;
- dead-letter alerting and an open read-only job inspector;
- signed provenance/SBOM verification and quarantine policy; and
- multi-host or multi-region Docker deployment guidance after the single-node
  profile.
