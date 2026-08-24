# ADR-007: Scope each local project to one root folder

**Status:** Accepted
**Date:** 2026-08-22
**Deciders:** Radius maintainers

## Context

Radius needs a durable project concept that groups related sessions and gives
those sessions a predictable local filesystem boundary. A project is not a
list of unrelated folders and is not a presentation-only sidebar group. It is
the user's explicit choice of one parent folder whose descendants form the
workspace for that project.

Absolute paths are installation-specific. Synchronizing a macOS path to
another computer would disclose local information and would not identify a
usable folder on the receiving device.

## Decision

Radius will model a project as a first-class, revisioned subject. Each local
client may bind that project to exactly one canonical root folder. Sessions
may optionally belong to one project; standalone sessions remain valid and do
not receive persistent project-folder access.

```text
projects
└── project_roots  one root per project and client instance

projects
└── sessions       zero or more sessions through sessions.project_id
```

`projects` contains portable metadata and tombstones. `project_roots` contains
the local absolute path and never enters sync envelopes. The composite primary
key `(project_id, client_instance_id)` enforces one root per project on one
installation. `(client_instance_id, root_path)` is unique so one folder cannot
silently back duplicate projects on the same installation.

Creating a project canonicalizes the chosen folder before persistence. A
synced project may appear disconnected on another installation until the user
explicitly links one local folder there.

### Filesystem capability

Linking the folder grants recursive read, create, update, rename, and delete
access within that root without per-file approval. It does not grant network,
credential, paid, public, or other external authority.

Every host filesystem operation must resolve its target against the canonical
root. Absolute input paths, parent traversal, symlinks that escape the root,
and moves whose source or destination resolves outside the root are denied.
Shell execution must eventually use an OS-enforced or container-enforced
writable-root sandbox; setting a process working directory alone is not a
security boundary.

## Consequences

- Radius projects remain useful offline and require no Cloud account.
- Project names may be changed independently from folder names.
- Local paths are neither synchronized nor exposed to a provider.
- Moving or removing a folder disconnects the local binding instead of
  broadening access or deleting project history.
- Hard project deletion is restricted while sessions reference it. Archiving
  and final data deletion remain explicit operations.
- Pinning and expanded/collapsed sidebar state are renderer preferences, not
  project schema fields.
- The supervised runtime and tool broker remain responsible for enforcing the
  same root for shell and agent capability execution when those packages are
  implemented.

## Validation

1. Verify one project/client cannot store two roots.
2. Verify one client/root cannot back two projects.
3. Verify session membership references an existing project.
4. Verify root paths do not occur in local changes or sync payloads.
5. Verify traversal and symlink escapes are rejected for existing and new
   paths.
6. Verify existing standalone sessions survive the forward migration with a
   null project relationship.
