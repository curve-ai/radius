# Detached chat windows

Radius keeps Scheduled, Connectors, Agents, Settings, and the chat library in
the main workspace. Saved chats can move into independent chat-only windows.
Each detached window groups one or more chats in the existing resizable,
collapsible left sidebar. This is application-owned window behavior on all
platforms; it does not use native macOS window tabs.

## Ownership and actions

Desktop main owns the window registry. A saved session has one editable view:
either the main workspace or one detached group. Its main sidebar row remains
in its project, Pinned, or Recents collection with a window indicator. Selecting
that row focuses its existing detached view. Moving a view never changes its
session ID, project membership, pin, or sync revision.

- Drag a chat row onto the desktop to open another window.
- Drop onto a detached sidebar to combine chats or change their local order.
- Drop onto the main sidebar or choose Bring back to return the live view.
- Native menus also expose Open in new window and Move to window. Detached
  rows support Alt+Up/Down to reorder and a separate Close tab action.
- Close tab releases the view; Archive changes the saved session through the
  existing storage operation. They are distinct actions.
- Detached windows are independent top-level windows. Closing main leaves them
  running; Open main window recreates or focuses the full workspace.
- Existing application quit semantics remain: closing the last window quits
  on Windows/Linux, while macOS remains active until explicitly quit.

## Transfer protocol

Window requests pass through the sandboxed, typed preload API. Main validates
the registered top-level sender and checks chat ownership for prompt and draft
mutations. Transfers are serialized.

1. Freeze source interaction and flush pending composer loading and writes.
2. Capture agent/model/thinking choices, transcript scroll position, and
   tool-panel visibility.
3. Stage the destination view, load its session-backed text draft, attachments
   and access mode, and wait for its transcript to load.
4. Commit ownership only after the destination acknowledges readiness.
5. Unfreeze on success or failure. A failed transfer retains source ownership;
   a newly created failed destination is closed.

Reopening a window restores all of its captured chat views into the renderer's
cache before the library selects a chat. Main retains presentation snapshots
until acknowledgement. Pending files, draft text and access mode load from
durable session/draft storage, including after application restart.
Moves within the owning main window leave the existing editor in place;
moves within a detached group only update its local order.

Inactive views retain a draft flush independent of transcript-loading UI.
Pending draft reads and writes can finish after a page unmounts. Submission
guards follow the actual in-flight send. Successful acceptance clears the
durable draft and pending attachment selection even after switching away.

Agent execution, transcript persistence/streaming, scheduling, authentication,
and storage stay in the application services. Moving a view does not start a
second agent run. A chat cannot move while its message submission is being
accepted. Pending approval and elicitation presentation rehydrates through the
existing session APIs.

Renderer File objects serve previews; the main process owns durable pending
files and validates attachment IDs within the session's draft. Attachment
bytes, access mode and draft text do not travel in window snapshots. Pending
files survive application quit/restart and remain device-local. See
[session composer persistence](session-composer-persistence-proposal.md) for
ownership, default-mode behavior, storage, and sync compatibility.

## Local layout and dragging

`chat-windows.json` under Electron's user-data directory records versioned
group IDs, tab ordering, active chats, and window bounds using an atomic file
replacement. Existing sessions and draft storage are reused without a schema
change. Restoring filters missing/archived sessions and clamps windows to an
available display. Selection and shell preferences are scoped to the window;
shared theme and saved-chat state remain shared.

The row gesture uses pointer capture and a movement threshold. Escape, lost
capture, and pointer cancellation cancel the drag. Main uses the operating
system cursor and content bounds in device-independent pixels for drop hit
testing, avoiding renderer `screenX` conversions on mixed-DPI displays. Drops
use app-window order maintained by native focus/show events, so an overlapping
destination takes precedence over windows behind it even while the source
has focus. Drops
inside content or onto a collapsed sidebar do not detach a chat. A new window
is created after the desktop drop; it does not follow the pointer mid-drag.

## Verification boundary

Unit coverage exercises ownership/order, desktop/sidebar/content drop targets,
negative display coordinates, presentation handoff, and capture failure.
It also covers overlapping-window order and restoring multiple cached views.
Disposable-profile Electron verification covers failed handoff, grouping,
selection, independent drafts, splitting, closing/reopening main, returning
chats, layout restoration, and native-sidebar transparency. Focused regressions
exercise main-window close/reopen and application restart with a File and Ask access,
same-main drops without capture/prepare, inactive-chat moves and native close
after delayed transcript loading, and overlapping destinations with controlled
focus events and cursor coordinates. An isolated React hook probe verifies
draft completion after unmount and rejection of late loads from old contexts.

Native pointer-capture behavior still needs a manual drag check on macOS and
Windows. The local native-input automation could inspect windows and activate
controls but rejected coordinate input with `windowNotFoundAtPosition`.
Windows runtime verification has not been performed in this local macOS task.
