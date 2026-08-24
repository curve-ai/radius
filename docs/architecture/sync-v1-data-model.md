# Sync v1 public and local data model

**Status:** Accepted
**Date:** 2026-08-21
**Scope:** Radius public protocol, encrypted local storage, artifacts, and sync orchestration

## Mission

Maintain Radius-owned projects and sessions on the user's computer and deliver
an optional, durable, provider-neutral copy to an authorized service without
making that service necessary for local work.

## Authority

Each project and session has one immutable origin client instance. Only that
instance may mutate the record. Other clients receive read-only mirrors. Every
mutation increments the subject revision by exactly one. Events and artifacts
are immutable; deletion uses tombstones. Multi-writer editing requires a later
protocol decision and is not implemented through last-write-wins.

A client instance is the cryptographic identity of one Radius installation,
not a physical-device fingerprint. It owns an Ed25519 keypair and can be
revoked independently. The local database may contain remote client identities
referenced by mirrored sessions, but exactly one row is marked `is_local` and
matches the operating-system credential vault.

## Typed session model

`session_events` is an ordered header, not a generic payload store. Every row
has exactly one typed subtype enforced by storage services and conformance
tests.

```text
client_instances
projects
project_roots
sessions
session_pins
session_events

agent_runs
event_runs
agent_run_state_updates
agent_run_presentations

messages
message_parts
reasoning_summaries

task_plans
task_steps
task_plan_events
task_step_updates

tool_calls
tool_progress_events
tool_results
project_files
project_file_versions
file_changes
approval_requests
approval_decisions
errors
```

Projects group zero or more sessions through nullable `sessions.project_id`.
`project_roots` maps one project to one canonical root path on one client
instance. Root paths are local capability configuration: they never appear in
the public project record, canonical payload, change log, or Cloud projection.
A mirrored project therefore requires an explicit local folder link before it
can grant filesystem access on the receiving installation.

`session_pins` records the local navigation preference that one client
instance pinned one session at a particular time. Its composite key is
`(client_instance_id, session_id)`; unpinning deletes the relationship. Pins
are local-only capability presentation, not origin-authoritative session data:
they never increment a session revision or enter the public protocol, local
change log, delivery queue, or Cloud projection. A receiving installation can
therefore pin a read-only mirrored session independently.

Messages have ordered text or artifact-reference parts. Tool inputs and outputs
remain versioned JSON because capabilities are extension-defined; each JSON
value carries a schema identifier and version and is validated before storage.

Reasoning summaries are intentional, user-visible agent summaries. Radius does
not request, depend on, or store raw chain-of-thought. Token-level streaming
deltas are transient; the completed message or summary is persisted.

Messages declare a presentation kind (`prompt`, `progress`, `final`,
`run_summary`, or `system_notice`). An agent run is a canonical execution and
audit boundary, not a collapsible UI assumption. Events may belong to one run;
the provider may append one optional presentation record choosing `inline` or
`collapsible`, an initial expanded/collapsed hint, a short label, and a
provider-authored summary message. Detailed events remain canonical.
When no presentation record exists, renderers show the run inline. Providers
need an explicit `inline` record only when they also supply presentation
metadata such as a label or summary.

Run state updates distinguish active work from waits and terminal outcomes.
Elapsed or active "Worked for" durations are derived from event timestamps and
state intervals rather than stored as calculated fields.

Progress is modeled as immutable task plans, ordered steps, and typed step-state
events (`pending`, `in_progress`, `completed`, `blocked`, `skipped`). The current
state is derived from the latest update rather than stored as a vague progress
string.

## Artifact model

Artifacts are immutable concrete outputs. A revision is a new artifact with an
optional `supersedes_artifact_id`; there is no mutable version counter.

```text
artifacts
├── file_artifacts   content hash, size, MIME type, local relative path
└── link_artifacts   URL, provider, optional external identifier

event_artifacts      input | output | attachment | preview relationship
```

File bytes live in a content-addressed directory outside libSQL. The sync
record contains hash and metadata, never the local path. A separate
`artifact_transfers` record coordinates upload and remote availability. Link
artifacts support outputs such as Google Slides without pretending Radius owns
their bytes.

## Project file changes

Projects own local working roots, but absolute roots remain in local-only
`project_roots` records and never enter the sync protocol. Agent mutations use
normalized project-relative POSIX paths.

```text
projects
├── project_roots             local client path, never synced
└── project_files             stable identity across rename or move
    └── project_file_versions immutable hash, size, MIME type, relative path

file_changes                  create | modify | relocate | delete
```

Every file-change event belongs to an agent run and identifies its optional
initiating tool call plus before/after versions. Text changes may include line
additions and deletions; binary and structured customer files use MIME type,
size, and provider/tool-specific previews instead of pretending they have line
diffs. Origin clients retain local version bytes for Review and hash-guarded
Undo; mirrored clients receive metadata and report the content as missing.

File changes are material outcomes. A renderer may show the same canonical
record chronologically inside expanded run activity and as a persistent outcome
card beside the final response. Provider-selected collapsing must never hide
the file-change outcome or remove its audit record.

## Sync infrastructure

```text
sync_connections
local_changes
sync_deliveries
artifact_transfers
sync_cursors
sync_inbox
```

One immutable Local Change is created transactionally with every project or
session revision. The public envelope is a discriminated union of
`project.upsert`, `project.delete`, `session.upsert`, `session.event.append`,
and `session.delete`; event payloads are themselves a typed discriminated
union. Sync runs at least once, while change IDs, payload digests, and inbox
receipts make application idempotent.

## Physical storage

- Embedded encrypted libSQL through Drizzle and `@libsql/client`.
- UUID strings as stable non-sensitive identifiers.
- UTC epoch milliseconds locally and ISO timestamps on the public protocol.
- Canonical JSON plus SHA-256 for transport-integrity checks.
- Foreign-key enforcement on every connection.
- Database key and private device key encrypted through the Electron host's
  operating-system-backed credential vault, never stored in database tables.

The accepted Drizzle definitions are in
`packages/storage/src/schema.ts`. The reviewed initial forward migration is
`packages/storage/drizzle/0000_initial_storage.sql`; durable scheduling and
one-root projects are added by `0001_durable_scheduling.sql` and
`0002_projects.sql`; typed agent-run/file-change additions are in
`0003_agent_run_file_changes.sql`, and local per-client session pins are in
`0004_session_pins.sql`. Radius never runs
`drizzle-kit push` against user data and never automatically applies a down
migration during application rollback.

## Local orchestration

The Electron host owns one single-flight loop per enabled provider. It wakes on
committed local changes, app start, manual request, reconnect, and a bounded
timer; pushes due deliveries, pulls through an opaque cursor, validates typed
records, applies remote data and inbox receipts atomically, and exposes only
sanitized status through IPC.

Remote application never creates a new Local Change. Enabling a provider adds
missing delivery rows for eligible authoritative history. Signing out disables
transfer and removes credentials without deleting canonical local records.

## V1 exclusions

- Concurrent session writers.
- Synchronizing local project-root paths.
- Raw chain-of-thought.
- Cloud-authored commands or messages.
- Scheduling and Cloud execution.
- Artifact bytes inside tRPC or sync envelopes.
- Database-page, WAL-frame, MongoDB-document, or raw SQL replication.
