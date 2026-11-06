import type { ChatDropZone } from "../chat-window-types";

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type ChatDropTarget =
  | { kind: "new-window" }
  | { kind: "cancel" }
  | { kind: "move"; windowId: string; before?: string };

/** Both cursor and content bounds come from Electron in DIP, never DOM screenX. */
export function findChatDropTarget(
  point: { x: number; y: number },
  sessionId: string,
  windows: Array<{
    id: string;
    bounds: Bounds;
    zone: ChatDropZone | null;
    stackOrder: number;
  }>,
): ChatDropTarget {
  // Focus/show events maintain front-to-back app order even while the drag
  // source has focus and all overlapping destination windows are unfocused.
  for (const { id, bounds, zone } of [...windows].sort(
    (a, b) => b.stackOrder - a.stackOrder,
  )) {
    const x = point.x - bounds.x,
      y = point.y - bounds.y;
    if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) continue;
    if (
      !zone ||
      x < zone.x ||
      x > zone.x + zone.width ||
      y < zone.y ||
      y > zone.y + zone.height
    )
      return { kind: "cancel" };
    return {
      kind: "move",
      windowId: id,
      before: zone.rows.find(
        (row) => y < row.middle && row.sessionId !== sessionId,
      )?.sessionId,
    };
  }
  return { kind: "new-window" };
}
