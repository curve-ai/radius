import { findChatDropTarget } from "./chat-drop-target";
import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  app,
  BrowserWindow,
  screen,
  type IpcMainInvokeEvent,
  type Rectangle,
} from "electron";
import {
  CHAT_WINDOWS_CHANNEL,
  CHAT_WINDOW_REQUEST_CHANNEL,
  type ChatDropZone,
  type ChatViewState,
  type ChatWindowRequest,
  type ChatWindowState,
} from "../chat-window-types";
import { listProjectSidebar, listRecentSidebar } from "./projects";
import { ChatWindowRegistry } from "./chat-window-registry";

type Entry = {
  window: BrowserWindow;
  active: string | null;
  view: ChatWindowState["requestedView"];
  zone: ChatDropZone | null;
  closing: boolean;
  ready: boolean;
  readyWaiters: Set<(error?: Error) => void>;
  stackOrder: number;
};
type Factory = (
  kind: "main" | "detached",
  bounds?: Partial<Rectangle>,
) => BrowserWindow;
const registry = new ChatWindowRegistry();
const windows = new Map<string, Entry>();
const snapshots = new Map<string, ChatViewState>();
const pending = new Map<
  string,
  {
    windowId: string;
    resolve: (states: Record<string, ChatViewState>) => void;
    reject: (error: Error) => void;
  }
>();
let factory: Factory;
let transferring = false;
let quitting = false;
let drag: { token: string; sessionId: string; source: string } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let windowStackOrder = 0;

function senderId(event: IpcMainInvokeEvent): string {
  const entry = [...windows].find(
    ([, value]) => value.window.webContents === event.sender,
  );
  if (!entry || event.senderFrame !== event.sender.mainFrame)
    throw new Error("Unknown chat window");
  return entry[0];
}

function state(id: string): ChatWindowState {
  const entry = windows.get(id)!;
  const group = registry.groups.get(id);
  return {
    id,
    kind: id === "main" ? "main" : "detached",
    sessionIds: group?.sessionIds ?? [],
    activeSessionId:
      id === "main" ? entry.active : (group?.activeSessionId ?? null),
    requestedView: entry.view,
    detached: registry.detached(),
    windows: [...windows]
      .filter(
        ([key, entry]) =>
          key !== "main" &&
          !entry.window.isDestroyed() &&
          registry.groups.get(key)?.sessionIds.length,
      )
      .map(([key, entry]) => ({
        id: key,
        title: entry.window.getTitle().replace(/ · Radius$/, ""),
      })),
    dragging: drag !== null,
    transferring,
  };
}

function scheduleLayoutSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLayout, 200);
}

function publish(): void {
  for (const [id, entry] of windows) {
    if (!entry.window.isDestroyed())
      entry.window.webContents.send(CHAT_WINDOWS_CHANNEL, state(id));
  }
  scheduleLayoutSave();
}

async function withChatTransfer(operation: () => Promise<void>): Promise<void> {
  if (transferring)
    throw new Error("Another chat is being moved. Try again in a moment.");
  transferring = true;
  try {
    await operation();
  } finally {
    transferring = false;
    // Clear provisional views and unfreeze the windows on either outcome.
    publish();
  }
}

function saveLayout(): void {
  saveTimer = null;
  if (quitting) return;
  const file = path.join(app.getPath("userData"), "chat-windows.json");
  const groups = [...windows]
    .filter(([id, entry]) => id !== "main" && !entry.window.isDestroyed())
    .map(([id, entry]) => ({
      id,
      ...registry.groups.get(id),
      bounds: entry.window.getNormalBounds(),
    }));
  try {
    writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, groups }), {
      mode: 0o600,
    });
    renameSync(`${file}.tmp`, file);
  } catch (error) {
    console.error("[chat-windows] Layout could not be saved", error);
  }
}

function focus(entry: Entry): void {
  if (entry.window.isMinimized()) entry.window.restore();
  entry.window.show();
  entry.window.focus();
}

function closeEmptyDetachedWindow(id: string): void {
  const entry = windows.get(id);
  if (id === "main" || !entry || registry.groups.get(id)?.sessionIds.length)
    return;
  // Let the initiating IPC reply reach its renderer before closing that window.
  setTimeout(() => {
    if (
      !entry.window.isDestroyed() &&
      !registry.groups.get(id)?.sessionIds.length
    ) {
      entry.closing = true;
      entry.window.close();
    }
  }, 50);
}

async function request(
  id: string,
  input:
    | Omit<Extract<ChatWindowRequest, { kind: "prepare" }>, "id">
    | Omit<Extract<ChatWindowRequest, { kind: "capture" }>, "id">
    | Omit<Extract<ChatWindowRequest, { kind: "restore-all" }>, "id">
    | { kind: "capture-all" },
): Promise<Record<string, ChatViewState>> {
  const entry = windows.get(id);
  if (!entry || entry.window.isDestroyed())
    return Promise.reject(new Error("The chat window closed"));
  if (!entry.ready)
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error): void => {
        clearTimeout(timer);
        entry.readyWaiters.delete(finish);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(
        () => finish(new Error("The chat window is not ready")),
        15_000,
      );
      entry.readyWaiters.add(finish);
    });
  if (entry.window.isDestroyed()) throw new Error("The chat window closed");
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(
        new Error(
          "The chat could not be moved. Try again when the window is ready.",
        ),
      );
    }, 15_000);
    pending.set(requestId, {
      windowId: id,
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    entry.window.webContents.send(CHAT_WINDOW_REQUEST_CHANNEL, {
      ...input,
      id: requestId,
    });
  });
}

function create(id: string, bounds?: Partial<Rectangle>): Entry {
  const entry: Entry = {
    window: factory(id === "main" ? "main" : "detached", bounds),
    active: null,
    view: null,
    zone: null,
    closing: false,
    ready: false,
    readyWaiters: new Set(),
    stackOrder: ++windowStackOrder,
  };
  windows.set(id, entry);
  const raise = (): void => {
    entry.stackOrder = ++windowStackOrder;
  };
  entry.window.on("focus", raise);
  entry.window.on("show", raise);
  entry.window.on("resize", scheduleLayoutSave);
  entry.window.on("move", scheduleLayoutSave);
  entry.window.on("close", (event) => {
    if (quitting || entry.closing) return;
    event.preventDefault();
    if (transferring) return;
    void withChatTransfer(async () => {
      try {
        const states = await request(id, { kind: "capture-all" });
        for (const [sessionId, snapshot] of Object.entries(states)) {
          if (registry.owner(sessionId) === id)
            snapshots.set(sessionId, snapshot);
        }
        entry.closing = true;
        entry.window.close();
      } catch (error) {
        if (!entry.window.isDestroyed())
          entry.window.webContents.send(
            "radius:chat-window-error",
            error instanceof Error
              ? error.message
              : "The window could not be closed",
          );
      }
    });
  });
  entry.window.on("closed", () => {
    windows.delete(id);
    if (drag?.source === id) drag = null;
    if (!quitting) registry.removeWindow(id);
    for (const finish of entry.readyWaiters)
      finish(new Error("The chat window closed"));
    for (const [requestId, waiter] of pending) {
      if (waiter.windowId === id) {
        pending.delete(requestId);
        waiter.reject(new Error("The chat window closed"));
      }
    }
    if (!quitting) publish();
  });
  return entry;
}

export function openMainChatWindow(): void {
  if (!factory) return;
  const entry = windows.get("main") ?? create("main");
  focus(entry);
}

function validSessionId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200)
    throw new Error("Invalid chat");
  return value;
}

async function assertSession(sessionId: string): Promise<void> {
  const [projects, recents] = await Promise.all([
    listProjectSidebar(),
    listRecentSidebar(),
  ]);
  if (
    ![...projects.flatMap((project) => project.sessions), ...recents].some(
      (session) => session.id === sessionId,
    )
  )
    throw new Error("This chat is no longer available");
}

async function transfer(
  sessionId: string,
  targetId?: string,
  before?: string,
): Promise<void> {
  await withChatTransfer(async () => {
    let created: Entry | undefined;
    let target: Entry | undefined;
    const owner = registry.owner(sessionId);
    try {
      await assertSession(sessionId);
      if (targetId === owner) {
        if (targetId !== "main") registry.move(sessionId, targetId, before);
        return;
      }
      if (windows.has(owner)) {
        const result = await request(owner, { kind: "capture", sessionId });
        if (result[sessionId]) snapshots.set(sessionId, result[sessionId]);
      }
      const destination = targetId ?? randomUUID();
      target = windows.get(destination);
      if (!target) {
        const cursor = screen.getCursorScreenPoint();
        const area = screen.getDisplayNearestPoint(cursor).workArea;
        created = target = create(destination, {
          x: Math.max(
            area.x,
            Math.min(cursor.x - 140, area.x + area.width - 900),
          ),
          y: Math.max(
            area.y,
            Math.min(cursor.y - 50, area.y + area.height - 700),
          ),
          width: Math.min(1100, area.width),
          height: Math.min(800, area.height),
        });
      }
      await request(destination, {
        kind: "prepare",
        sessionId,
        state: snapshots.get(sessionId) ?? null,
      });
      snapshots.delete(sessionId);
      registry.move(sessionId, destination, before);
      target.active = sessionId;
      if (owner === "main" && destination !== "main") {
        const main = windows.get("main");
        if (main?.active === sessionId) main.active = null;
      }
      publish();
      focus(target);
      closeEmptyDetachedWindow(owner);
    } catch (error) {
      if (created && !created.window.isDestroyed()) {
        created.closing = true;
        created.window.close();
      }
      throw error;
    }
  });
}

export function releaseArchivedChat(sessionId: string): void {
  const owner = registry.owner(sessionId);
  registry.move(sessionId, "main");
  snapshots.delete(sessionId);
  closeEmptyDetachedWindow(owner);
  publish();
}

export function assertChatWindowOwnsSession(
  event: IpcMainInvokeEvent,
  sessionId: unknown,
): void {
  if (
    typeof sessionId === "string" &&
    registry.owner(sessionId) !== senderId(event)
  )
    throw new Error("This chat is open in another window");
}

export function initializeChatWindows(
  createWindow: Factory,
  handle: typeof import("electron").ipcMain.handle,
): void {
  factory = createWindow;
  app.on("before-quit", () => {
    saveLayout();
    quitting = true;
  });
  handle("radius:chat-window-state", (event) => {
    const id = senderId(event);
    const entry = windows.get(id)!;
    entry.ready = true;
    for (const finish of entry.readyWaiters) finish();
    return state(id);
  });
  handle("radius:chat-window-restore-views", async (event) => {
    const id = senderId(event);
    const states = Object.fromEntries(
      [...snapshots].filter(([sessionId]) => registry.owner(sessionId) === id),
    );
    if (!Object.keys(states).length) return;
    // The renderer hydrates its cache before selecting a chat. Keep main's
    // copies until acknowledgement, including if the window closes mid-boot.
    await request(id, { kind: "restore-all", states });
    for (const [sessionId, snapshot] of Object.entries(states)) {
      if (snapshots.get(sessionId) === snapshot) snapshots.delete(sessionId);
    }
  });
  handle("radius:chat-window-reply", (event, id, result) => {
    const sender = senderId(event);
    const waiter = pending.get(id);
    if (!waiter || waiter.windowId !== sender)
      throw new Error("Invalid window response");
    pending.delete(id);
    if (result?.error) {
      waiter.reject(new Error(String(result.error).slice(0, 240)));
      return;
    }
    try {
      const states = result?.states ?? {};

      if (Object.keys(states).length > 1000)
        throw new Error("Too many chat views");
      for (const snapshot of Object.values(states) as ChatViewState[]) {
        if (
          !snapshot ||
          !Number.isFinite(snapshot.scrollTop) ||
          snapshot.scrollTop < 0 ||
          typeof snapshot.atBottom !== "boolean"
        )
          throw new Error("Invalid chat view");
        for (const value of [
          snapshot.agentId,
          snapshot.modelId,
          snapshot.thinkingEffortId,
        ]) {
          if (
            value !== null &&
            (typeof value !== "string" || value.length > 2000)
          )
            throw new Error("Invalid chat selection");
        }
      }
      waiter.resolve(states);
    } catch (error) {
      waiter.reject(
        error instanceof Error ? error : new Error("Invalid chat state"),
      );
    }
  });
  handle("radius:chat-window-move", (event, value, windowId) => {
    senderId(event);
    if (typeof windowId !== "string" || !windows.has(windowId))
      throw new Error("That window is no longer open");
    return transfer(validSessionId(value), windowId);
  });
  handle("radius:chat-window-detach", (event, value) => {
    senderId(event);
    return transfer(validSessionId(value));
  });
  handle("radius:chat-window-bring-back", (event, value) => {
    senderId(event);
    return transfer(validSessionId(value), "main");
  });
  handle("radius:chat-window-reorder", (event, value, direction) => {
    const id = senderId(event),
      sessionId = validSessionId(value);
    assertChatWindowOwnsSession(event, sessionId);
    const group = registry.groups.get(id);
    if (!group || transferring || !["up", "down"].includes(direction)) return;
    const index = group.sessionIds.indexOf(sessionId);
    if (
      index < 0 ||
      (direction === "up" ? index === 0 : index === group.sessionIds.length - 1)
    )
      return;
    const before = group.sessionIds[index + (direction === "up" ? -1 : 2)];
    registry.move(sessionId, id, before);
    publish();
  });
  handle("radius:chat-window-close", async (event, value) => {
    const id = senderId(event),
      sessionId = validSessionId(value);
    assertChatWindowOwnsSession(event, sessionId);
    if (id === "main") throw new Error("This chat cannot be closed right now");
    await withChatTransfer(async () => {
      const states = await request(id, { kind: "capture", sessionId });
      if (states[sessionId]) snapshots.set(sessionId, states[sessionId]);
      registry.move(sessionId, "main");
      publish();
      closeEmptyDetachedWindow(id);
    });
  });
  handle("radius:chat-window-focus", async (event, value) => {
    const caller = senderId(event);
    const sessionId = validSessionId(value);
    const owner = registry.owner(sessionId);
    if (owner === caller) {
      const snapshot = snapshots.get(sessionId);
      if (snapshot) {
        await withChatTransfer(async () => {
          await request(caller, {
            kind: "prepare",
            sessionId,
            state: snapshot,
          });
          snapshots.delete(sessionId);
          windows.get(caller)!.active = sessionId;
        });
        return true;
      }
      return false;
    }
    const entry = windows.get(owner);
    if (!entry) return false;
    entry.active = sessionId;
    const group = registry.groups.get(owner);
    if (group) group.activeSessionId = sessionId;
    publish();
    focus(entry);
    return true;
  });
  handle("radius:chat-window-select", (event, value) => {
    const id = senderId(event);
    if (value === null && id === "main") {
      windows.get(id)!.active = null;
      publish();
      return;
    }
    const sessionId = validSessionId(value);
    assertChatWindowOwnsSession(event, sessionId);
    windows.get(id)!.active = sessionId;
    const group = registry.groups.get(id);
    if (group) group.activeSessionId = sessionId;
    publish();
  });
  handle("radius:chat-window-open-main", (event, view) => {
    senderId(event);
    openMainChatWindow();
    if (["settings", "agents", "connectors", "workspace"].includes(view)) {
      const entry = windows.get("main")!;
      entry.view = view;
      publish();
      entry.window.webContents.send("radius:chat-main-navigate", view);
    }
  });
  handle("radius:chat-window-rename", (event, value) => {
    senderId(event);
    const sessionId = validSessionId(value),
      owner = registry.owner(sessionId);
    const entry = windows.get(owner);
    if (!entry) throw new Error("That chat window is no longer open");
    entry.active = sessionId;
    const group = registry.groups.get(owner);
    if (group) group.activeSessionId = sessionId;
    publish();
    focus(entry);
    entry.window.webContents.send("radius:chat-window-rename", sessionId);
  });
  handle("radius:chat-window-drop-zone", (event, zone) => {
    const entry = windows.get(senderId(event))!;
    if (zone === null) {
      entry.zone = null;
      return;
    }
    if (
      ![zone.x, zone.y, zone.width, zone.height].every(Number.isFinite) ||
      !Array.isArray(zone.rows) ||
      zone.rows.length > 1000
    )
      throw new Error("Invalid drop region");
    entry.zone = zone;
  });
  handle("radius:chat-window-drag-begin", async (event, value, token) => {
    const source = senderId(event);
    if (drag || typeof token !== "string" || token.length > 64)
      throw new Error("A drag is already active");
    const sessionId = validSessionId(value);
    await assertSession(sessionId);
    drag = { token, sessionId, source };
    publish();
  });
  handle("radius:chat-window-drag-end", async (event, token, cancelled) => {
    const source = senderId(event);
    if (!drag || drag.token !== token || drag.source !== source) return;
    const current = drag;
    drag = null;
    publish();
    if (cancelled) return;
    const cursor = screen.getCursorScreenPoint();
    // The OS cursor and content bounds are both DIP; renderer screenX differs on mixed-DPI Windows displays.
    const target = findChatDropTarget(
      cursor,
      current.sessionId,
      [...windows]
        .filter(
          ([, entry]) =>
            entry.window.isVisible() && !entry.window.isMinimized(),
        )
        .map(([id, entry]) => ({
          id,
          bounds: entry.window.getContentBounds(),
          zone: entry.zone,
          stackOrder: entry.stackOrder,
        })),
    );
    if (target.kind === "move")
      await transfer(current.sessionId, target.windowId, target.before);
    else if (target.kind === "new-window") await transfer(current.sessionId);
  });
}

export async function restoreChatWindows(): Promise<void> {
  const file = path.join(app.getPath("userData"), "chat-windows.json");
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    if (saved.version !== 1 || !Array.isArray(saved.groups)) return;
    const [projects, recents] = await Promise.all([
      listProjectSidebar(),
      listRecentSidebar(),
    ]);
    const available = new Set(
      [...projects.flatMap((project) => project.sessions), ...recents].map(
        (session) => session.id,
      ),
    );
    for (const group of saved.groups.slice(0, 20)) {
      if (!Array.isArray(group.sessionIds)) continue;
      const ids = group.sessionIds.filter(
        (id: unknown): id is string =>
          typeof id === "string" &&
          available.has(id) &&
          registry.owner(id) === "main",
      );
      if (!ids.length) continue;
      const id =
        typeof group.id === "string" &&
        /^[0-9a-f-]{36}$/.test(group.id) &&
        !windows.has(group.id)
          ? group.id
          : randomUUID();
      const b = group.bounds;
      const area =
        b &&
        [b.x, b.y, b.width, b.height].every(Number.isFinite) &&
        b.width > 0 &&
        b.height > 0
          ? screen.getDisplayMatching(b).workArea
          : screen.getPrimaryDisplay().workArea;
      const bounds =
        b && [b.x, b.y, b.width, b.height].every(Number.isFinite)
          ? {
              x: Math.max(area.x, Math.min(b.x, area.x + area.width - 480)),
              y: Math.max(area.y, Math.min(b.y, area.y + area.height - 200)),
              width: Math.min(Math.max(480, b.width), area.width),
              height: Math.min(Math.max(620, b.height), area.height),
            }
          : undefined;
      for (const sessionId of ids) registry.move(sessionId, id);
      registry.groups.get(id)!.activeSessionId = ids.includes(
        group.activeSessionId,
      )
        ? group.activeSessionId
        : ids[0];
      const entry = create(id, bounds);
      entry.window.once("ready-to-show", () => entry.window.show());
    }
    publish();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    console.error("[chat-windows] Layout could not be restored", error);
  }
}
