import type {
  NativeControlMenuItem,
  NativeControlMenuPoint,
} from "../../../../radius-api";

const PROJECT_ACTION = {
  reveal: "reveal",
  rename: "rename",
  togglePin: "toggle-pin",
} as const;
const RECENTS_ACTION = { markAllRead: "mark-all-read" } as const;

export interface ProjectActionMenuOptions {
  pinned: boolean;
  rootCount: number;
  onEdit: () => void;
  onReveal: () => void;
  onTogglePin: () => void;
}

export interface RecentsActionMenuOptions {
  hasUnreadChats: boolean;
  onMarkAllRead: () => void;
}

async function showMenu(
  items: NativeControlMenuItem[],
  point: NativeControlMenuPoint,
): Promise<string | null> {
  return window.radius.showNativeControlMenu({
    items,
    point,
    positioningItem: 0,
  });
}

export async function showProjectActionMenu(
  options: ProjectActionMenuOptions,
  point: NativeControlMenuPoint,
): Promise<void> {
  const revealItems: NativeControlMenuItem[] =
    options.rootCount > 0
      ? [
          {
            id: PROJECT_ACTION.reveal,
            label: "Reveal in Finder",
            icon: "folder",
          },
          { type: "separator" },
        ]
      : [];
  const selection = await showMenu(
    [
      {
        id: PROJECT_ACTION.togglePin,
        label: options.pinned ? "Unpin" : "Pin",
        icon: options.pinned ? "pin.slash" : "pin",
      },
      { id: PROJECT_ACTION.rename, label: "Edit", icon: "pencil" },
      { type: "separator" },
      ...revealItems,
      {
        id: "archive",
        label: "Archive chats",
        icon: "archivebox",
        enabled: false,
        toolTip: "Project chat archiving is not implemented yet",
        widthHint: 4,
      },
      { type: "separator" },
      {
        id: "remove",
        label: "Remove project",
        icon: "xmark",
        enabled: false,
        toolTip: "Project removal semantics are not defined yet",
      },
    ],
    point,
  );

  switch (selection) {
    case PROJECT_ACTION.togglePin:
      options.onTogglePin();
      break;
    case PROJECT_ACTION.rename:
      options.onEdit();
      break;
    case PROJECT_ACTION.reveal:
      options.onReveal();
      break;
  }
}

export async function showRecentsActionMenu(
  options: RecentsActionMenuOptions,
  point: NativeControlMenuPoint,
): Promise<void> {
  const selection = await showMenu(
    [
      {
        id: RECENTS_ACTION.markAllRead,
        label: "Mark all as read",
        icon: "checkmark",
        enabled: options.hasUnreadChats,
        toolTip: options.hasUnreadChats ? undefined : "No unread chats",
      },
      { type: "separator" },
      {
        id: "archive",
        label: "Archive chats",
        icon: "archivebox",
        enabled: false,
        toolTip: "Bulk chat archiving needs a recovery view first",
      },
    ],
    point,
  );

  if (selection === RECENTS_ACTION.markAllRead) options.onMarkAllRead();
}
