import { sessionTranscriptAsMarkdown } from "./session-copy";
import type {
  NativeControlMenuItem,
  NativeControlMenuLeafItem,
  NativeControlMenuPoint,
} from "../../../../radius-api";

const SESSION_ACTION = {
  archive: "archive",
  copyMarkdown: "copy-markdown",
  copySessionId: "copy-session-id",
  copyWorkingDirectory: "copy-working-directory",
  markUnread: "mark-unread",
  rename: "rename",
  togglePin: "toggle-pin",
} as const;

export interface SessionActionMenuOptions {
  canMarkUnread: boolean;
  pinned: boolean;
  sessionId: string;
  title: string;
  workingDirectories: string[];
  onArchive: () => void | Promise<void>;
  onMarkUnread: () => void;
  onRename: () => void;
  onTogglePin: () => void | Promise<void>;
}

export async function showSessionActionMenu(
  options: SessionActionMenuOptions,
  point: NativeControlMenuPoint,
): Promise<void> {
  const copyItems: NativeControlMenuLeafItem[] = [
    {
      id: SESSION_ACTION.copyWorkingDirectory,
      label: "Copy working directory",
      icon: "document.on.document",
      enabled: options.workingDirectories.length > 0,
      toolTip:
        options.workingDirectories.length > 0
          ? undefined
          : "This chat has no working directory",
    },
    {
      id: SESSION_ACTION.copySessionId,
      label: "Copy session ID",
      icon: "document.on.document",
    },
    {
      id: SESSION_ACTION.copyMarkdown,
      label: "Copy as Markdown",
      icon: "document.on.document",
    },
  ];
  const items: NativeControlMenuItem[] = [
    {
      id: SESSION_ACTION.togglePin,
      label: options.pinned ? "Unpin" : "Pin",
      icon: options.pinned ? "pin.slash" : "pin",
    },
    { id: SESSION_ACTION.rename, label: "Rename", icon: "pencil" },
    {
      id: SESSION_ACTION.markUnread,
      label: "Mark as unread",
      icon: "eye",
      enabled: options.canMarkUnread,
    },
    {
      id: SESSION_ACTION.archive,
      label: "Archive",
      icon: "archivebox",
    },
    { type: "separator" },
    {
      id: "share",
      label: "Share",
      icon: "square.and.arrow.up",
      enabled: false,
      toolTip: "Chat sharing is not implemented yet",
    },
    {
      id: "copy",
      label: "Copy",
      icon: "document.on.document",
      submenu: copyItems,
    },
    { type: "separator" },
    {
      id: "open-new-window",
      label: "Open in new window",
      icon: "macwindow",
      enabled: false,
      toolTip: "Opening a chat in another window is not implemented yet",
    },
  ];
  const selection = await window.radius.showNativeControlMenu({
    items,
    point,
    positioningItem: 0,
  });

  if (selection === SESSION_ACTION.togglePin) await options.onTogglePin();
  else if (selection === SESSION_ACTION.rename) options.onRename();
  else if (selection === SESSION_ACTION.markUnread) options.onMarkUnread();
  else if (selection === SESSION_ACTION.archive) await options.onArchive();
  else if (selection === SESSION_ACTION.copyWorkingDirectory) {
    await window.radius.writeClipboardText(
      options.workingDirectories.join("\n"),
    );
  } else if (selection === SESSION_ACTION.copySessionId) {
    await window.radius.writeClipboardText(options.sessionId);
  } else if (selection === SESSION_ACTION.copyMarkdown) {
    const events = await window.radius.listSessionTranscript(options.sessionId);
    await window.radius.writeClipboardText(
      sessionTranscriptAsMarkdown(options.title, events),
    );
  }
}
