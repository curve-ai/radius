# ADR-006: Use libSQL-backed durable local scheduling

**Status:** Accepted
**Date:** 2026-08-22
**Deciders:** Radius maintainers

## Context

Radius needs recurring local agent work without requiring Cloud, Redis, a job
broker, or operating-system cron registration. The computer may sleep, the
desktop application may exit, and the runtime may crash between accepting and
settling work. An in-memory timer alone cannot reconstruct what was missed or
distinguish a stale worker from the current owner of a run.

## Decision

Radius will store schedule definitions and materialized scheduled runs in the
existing encrypted libSQL operational database. A TypeScript coordinator will
calculate recurrence, materialize due runs transactionally, claim ready runs
with expiring leases, and dispatch them to the supervised local runtime.

The database is authoritative. Timers are disposable wake-up hints. Startup,
system resume, unlock, and a periodic safety wake all reconcile persisted state
before new work is dispatched.

### Subjects

- `schedules` stores the current recurring definition, IANA timezone,
  missed-run policy, revision, and versioned execution request.
- `scheduled_runs` stores one intended occurrence, an immutable execution
  request snapshot, coalescing evidence, durable dispatch state, and the
  current lease.

The alternate key `(schedule_id, scheduled_for_ms)` prevents duplicate
materialization. Schedule removal is normally a soft delete, and physical
deletion is restricted while run history exists.

### Dispatch semantics

Scheduled dispatch is at least once. Every run UUID is also its idempotency key.
An expired lease may be reclaimed after a crash, while settlement requires the
current lease token so a stale worker cannot overwrite a newer owner.

The scheduler owns durable dispatch only. Once a run is attached to a session,
the runtime owns execution, approvals, cancellation, and recovery. External
effects must use the run or session idempotency key because a local database
cannot make a remote side effect exactly once.

### Missed runs

- `catch_up_once` coalesces missed occurrences into one run and is the default.
- `skip` records coalesced skipped evidence and waits for the next occurrence.
- `ask` materializes a pending run with no availability time until confirmed.
- `replay_all` materializes occurrences up to the configured replay limit and
  records the remainder as skipped.

## Consequences

- Radius adds no scheduling server, queue daemon, Redis dependency, or OS cron
  installation.
- Schedule evaluation remains available offline and follows desktop/runtime
  availability.
- The host-owned storage service remains the only database writer; renderers
  and agent containers cannot claim runs or mutate leases directly.
- Recurrence uses five-field cron expressions with explicit IANA timezones.
- Cloud may optionally project schedule records later, but local libSQL remains
  authoritative and Cloud does not become an undeclared execution fallback.

## Validation

1. Verify duplicate occurrence materialization is rejected transactionally.
2. Verify expired leases are reclaimable and stale lease tokens cannot settle.
3. Verify request snapshots survive later schedule revisions.
4. Verify sleep catch-up, skip, ask, and bounded replay behavior.
5. Verify timezone and daylight-saving transitions.
6. Verify desktop startup, resume, unlock, and shutdown lifecycle behavior.
