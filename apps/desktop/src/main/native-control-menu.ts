import {
  BrowserWindow,
  Menu,
  nativeImage,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type NativeImage,
} from "electron";

import type {
  NativeControlMenuIcon,
  NativeControlMenuInput,
  NativeControlMenuItem,
  NativeControlMenuLeafItem,
} from "../radius-api";

const ICONS = new Set<NativeControlMenuIcon>([
  "archivebox",
  "checkmark",
  "document.on.document",
  "eye",
  "folder",
  "macwindow",
  "pencil",
  "pin",
  "pin.slash",
  "square.and.arrow.up",
  "xmark",
]);

function controlMenuIcon(icon: NativeControlMenuIcon): NativeImage | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    return nativeImage.createMenuSymbol(icon);
  } catch {
    return undefined;
  }
}

function parseControlMenuItems(
  value: unknown,
  depth = 0,
): NativeControlMenuItem[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    return [];
  }
  if (depth > 1) return [];

  const items: NativeControlMenuItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    if (candidate.type === "separator") {
      items.push({ type: "separator" });
      continue;
    }
    if (
      typeof candidate.id !== "string" ||
      candidate.id.length === 0 ||
      candidate.id.length > 64 ||
      typeof candidate.label !== "string" ||
      candidate.label.length === 0 ||
      candidate.label.length > 120
    ) {
      return [];
    }

    const icon = ICONS.has(candidate.icon as NativeControlMenuIcon)
      ? (candidate.icon as NativeControlMenuIcon)
      : undefined;
    const submenu =
      candidate.submenu === undefined
        ? undefined
        : parseControlMenuItems(candidate.submenu, depth + 1);
    if (candidate.submenu !== undefined && submenu?.length === 0) return [];
    const widthHint = Number.isInteger(candidate.widthHint)
      ? Math.max(0, Math.min(Number(candidate.widthHint), 8))
      : undefined;
    const parsedItem = {
      id: candidate.id,
      label: candidate.label,
      enabled: candidate.enabled !== false,
      icon,
      widthHint,
      toolTip:
        typeof candidate.toolTip === "string"
          ? candidate.toolTip.slice(0, 240)
          : undefined,
    };
    items.push(
      submenu
        ? { ...parsedItem, submenu: submenu as NativeControlMenuLeafItem[] }
        : parsedItem,
    );
  }

  return items;
}

function parseControlMenuInput(value: unknown): NativeControlMenuInput | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const items = parseControlMenuItems(candidate.items);
  if (items.length === 0) return null;

  const pointValue = candidate.point;
  const point =
    pointValue &&
    typeof pointValue === "object" &&
    Number.isFinite((pointValue as Record<string, unknown>).x) &&
    Number.isFinite((pointValue as Record<string, unknown>).y)
      ? {
          x: Math.round((pointValue as { x: number }).x),
          y: Math.round((pointValue as { y: number }).y),
        }
      : undefined;
  const positioningItem = Number.isInteger(candidate.positioningItem)
    ? Math.max(0, Math.min(Number(candidate.positioningItem), items.length - 1))
    : 0;

  return { items, point, positioningItem };
}

export function showNativeControlMenuForRenderer(
  event: IpcMainInvokeEvent,
  value: unknown,
): Promise<string | null> {
  const input = parseControlMenuInput(value);
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!input || !window || window.isDestroyed()) return Promise.resolve(null);

  return new Promise((resolve) => {
    let selectedId: string | null = null;
    const buildTemplate = (
      items: NativeControlMenuItem[],
    ): MenuItemConstructorOptions[] =>
      items.map((item) => {
        if (item.type === "separator") return { type: "separator" };
        return {
          type: "normal",
          label: `${item.label}${"\u2007".repeat(item.widthHint ?? 0)}`,
          accessibilityLabel: item.label,
          enabled: item.enabled !== false,
          icon: item.icon ? controlMenuIcon(item.icon) : undefined,
          submenu: item.submenu ? buildTemplate(item.submenu) : undefined,
          toolTip: item.toolTip,
          click: item.submenu
            ? undefined
            : () => {
                selectedId = item.id;
              },
        };
      });
    const template = buildTemplate(input.items);
    const menu = Menu.buildFromTemplate(template);
    const [width, height] = window.getContentSize();
    const point = input.point
      ? {
          x: Math.max(0, Math.min(input.point.x, width)),
          y: Math.max(0, Math.min(input.point.y, height)),
        }
      : undefined;

    menu.popup({
      window,
      frame: event.senderFrame ?? undefined,
      x: point?.x,
      y: point?.y,
      positioningItem:
        process.platform === "darwin" ? input.positioningItem : undefined,
      callback: () => resolve(selectedId),
    });
  });
}
