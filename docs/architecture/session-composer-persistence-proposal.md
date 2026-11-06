# Session composer persistence

Status: approved by Alexey on 2026-11-01; implemented locally, uncommitted.

## Purpose

Make pending attachments and access choices belong to the saved chat rather
than its mounted window. Keep a durable app-wide default for future chats.
Opening, detaching, closing, or restarting a window must not change these
values. Validation uses disposable databases and Electron profiles.

## Prior behavior

- Text drafts persist in `composer_drafts`, scoped to a client and either a
  saved session or a new-chat/project context.
- Pending attachments are renderer `File` objects. Window handoff serializes
  their bytes into an in-memory snapshot. Explicit application quit loses them.
- Access mode is component state, initially `project`, or restored from that
  same snapshot. There is no durable global default or session access field.
- Submitted attachments already use managed content-addressed files and
  session/message artifact records. These remain the submitted-file history.

## Ownership and observable behavior

| Value                                   | Owner                                   | Behavior                                                                  |
| --------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| `session.accessMode`                    | Saved session                           | Durable explicit `ask`, `project`, or `full`; used for subsequent prompts |
| `session.draft.attachments`             | Session's durable composer draft        | Ordered pending files, backed by managed bytes and metadata               |
| `app.defaultAccessMode`                 | Local installation                      | Durable default shared by every window on that installation               |
| Unsent new-chat draft                   | Existing new-chat/project draft context | Holds text and files before a saved session exists                        |
| Scroll, panel visibility, window bounds | View/window                             | Remain presentation state                                                 |

Changing mode in an existing session updates that session and the app default
in one transaction. Other existing sessions retain their own explicit modes.
Opening an existing session reads its mode without changing the default.
Changing mode on a new-chat composer updates the default. Untouched new-chat
composers in other windows follow that default; no saved session is changed.
Creating a saved session copies the selected default as an explicit session
value. Merely changing a global default never rewrites old sessions.

A mode change affects future prompt acceptance; it does not silently alter the
policy of an already executing run. Main reads and validates the saved mode
when accepting a prompt rather than trusting a window-local selection.

## Approved logical data changes

1. Add a non-null access mode to `sessions`, with the three supported values.
   Existing sessions initialize to `project`, matching their current fallback;
   new sessions explicitly copy the current default. Session mode mutations
   participate in the existing session revision and change-capture machinery.
2. Add one local desktop-preferences record per client instance, keyed by that
   existing instance ID, containing the default access mode and update time.
   The client relationship cascades on hard deletion. Initial default is
   `project`; all windows subscribe to committed preference changes.
3. Add ordered attachment child records to `composer_drafts`. Each has a stable
   ID, draft foreign key, unique position within that draft, display name, MIME
   type, byte size, content hash, managed relative file location, and source
   modification time. One attachment belongs to exactly one draft; hard draft
   deletion cascades to its attachment records. File contents use the existing
   managed content-addressed byte-writing mechanism, not original user paths.
4. Permit empty draft text so attachment-only drafts can exist. Application
   operations remove a draft only when both text and pending attachments are
   empty. Text edits must not delete attachment selections as a side effect.

The session API returns the pending attachment collection as part of its
composer state. Relational child records implement that collection; neither
the window registry nor a JSON array on the session row owns file bytes.
Existing draft scoping by client/session is retained, so drafts remain
device-local while surviving every window lifetime and application restart.

Session mode is part of saved-session data. Its public sync contract must be
updated compatibly: an older payload that omits mode must not reset a newer
stored selection. The compatibility design must cover creation, title-only
updates, export/import, and revision conflicts before implementation. The
app-wide default and unsent draft files remain local; this proposal does not
add cross-device draft-file synchronization or operated Cloud storage.

## Attachment lifecycle and integrity

- Adding a file validates bounds and copies its bytes into managed storage
  before committing the pending attachment record. A successful add therefore
  survives source-file movement, window closure, and application restart.
- Removal deletes only that draft's attachment reference. Shared bytes are
  reclaimed only after both draft and submitted-artifact references are gone.
- Successful submission attaches the accepted files to the existing message
  and session artifact history, then clears the accepted draft selections.
  Failure retains the text and files. Repeated acceptance must not duplicate
  the submitted attachment records.
- New-chat submission adopts its existing draft files into the created session
  and accepted message. It does not require creating a saved empty session
  merely to select an attachment.
- Soft archive retains draft data; hard session deletion cascades through its
  draft and pending attachments. File cleanup follows remaining references.
- Main validates ownership, file count/size, metadata, hash, and managed-path
  containment. Renderers receive stable attachment IDs and preview data rather
  than becoming the authoritative file store.

## Desktop change and verification

Windows open the same session-backed composer state and subscribe to changes.
Window moves transfer session IDs plus presentation state; attachment bytes
and access mode are removed from the window snapshot protocol once the
persistent model is active.

Verification must cover attachment-only drafts, restart and detachment,
deleting the original selected file, removal and shared-file cleanup, failed
submission, accepted-submission clearing, new-chat adoption, per-session mode
isolation, cross-window defaults, and legacy session/sync compatibility.

SQLite migration `0015_session_composer` adds the approved fields and tables,
preserving existing text drafts and initializing legacy modes to `project`.
The public Platform projection uses PostgreSQL migration
`0004_session_access_mode`. Existing migrations are unchanged.

The optional sync payload field preserves modes when a legacy rename omits it.
Providers advertise `sessionAccessMode` support; mode-bearing changes stay
queued with an upgrade-required error when a provider lacks that capability.
Peers need the updated contract to read mode-bearing changes. No private Cloud
implementation or deployment is included.

Pending files use managed `artifacts/drafts/<prefix>/<hash>` storage. Submitted
artifacts retain their existing byte namespace. Import failure, explicit
removal, accepted submission and startup cleanup reclaim unreferenced pending
bytes. Multiple pending references keep shared content alive; hard draft
deletion cascades its rows and startup cleanup reclaims orphaned bytes.

Any materially different sync or draft-ownership design requires renewed
approval under the workspace policy.
