# ADR-007: Allow each local project multiple source folders

**Status:** Accepted
**Date:** 2026-08-22
**Deciders:** Radius maintainers

## Context

Radius needs a durable project concept that groups related sessions. A project
may also give those sessions a predictable local filesystem boundary, but
creating the organizational context must not require granting file access. A
project is not a list of unrelated folders or a presentation-only sidebar
group. When linked, each selected parent folder and its descendants form the
filesystem workspace for that project.

Absolute paths are installation-specific. Synchronizing a macOS path to
another computer would disclose local information and would not identify a
usable folder on the receiving device.

## Decision

Radius will model a project as a first-class, revisioned subject. Each local
client may leave that project unbound or bind it to any number of canonical
source folders. Sessions may optionally belong to one project; both standalone
sessions and sessions in an unbound project remain valid and do not receive
persistent project-folder access.

```text
projects
└── project_roots  zero or more roots per project and client instance

projects
└── sessions       zero or more sessions through sessions.project_id
```

`projects` contains portable metadata and tombstones. `project_roots` contains
one local source-folder binding per row and never enters sync envelopes. Each
binding has an opaque local identifier so paths are not used as mutable or
sensitive record keys. `(client_instance_id, root_path)` remains unique so one
folder cannot silently back duplicate projects on the same installation.

Creating a project requires only its portable name. If the user chooses source
folders during creation or adds them later, Radius canonicalizes each path
before persistence. A synced project may appear without local file access on
another installation until the user explicitly adds local source folders.

### Filesystem capability

Linking source folders grants recursive read, create, update, rename, and delete
access within those roots without per-file approval. It does not grant network,
credential, paid, public, or other external authority.

Every host filesystem operation must resolve its target against the canonical
root set. Absolute input paths, parent traversal, symlinks that escape every
root, and moves whose source or destination resolves outside the roots are denied.
Shell execution must eventually use an OS-enforced or container-enforced
writable-root sandbox; setting a process working directory alone is not a
security boundary.

## Consequences

- Radius projects remain useful offline and require no Cloud account.
- Projects can group sessions without granting local filesystem access.
- Project names may be changed independently from folder names.
- Local paths are neither synchronized nor exposed to a provider.
- Moving or removing a source folder disconnects only that local binding instead of
  broadening access or deleting project history.
- Hard project deletion is restricted while sessions reference it. Archiving
  and final data deletion remain explicit operations.
- Pinning and expanded/collapsed sidebar state are renderer preferences, not
  project schema fields.
- The supervised runtime and tool broker remain responsible for enforcing the
  union of linked roots for shell and agent capability execution when those
  packages are implemented.

## Validation

1. Verify a project with no roots can be created and can contain sessions.
2. Verify one project/client can store multiple roots.
3. Verify one client/root cannot back two projects or occur twice in one project.
4. Verify adding and removing roots does not create sync changes.
5. Verify the migration preserves existing single-root bindings.
6. Verify session membership references an existing project.
7. Verify root paths do not occur in local changes or sync payloads.
8. Verify traversal and symlink escapes are rejected for existing and new
   paths.
9. Verify existing standalone sessions survive the forward migration with a
   null project relationship.
