export const CHAT_WINDOWS_CHANNEL = "radius:chat-windows";
export const CHAT_WINDOW_REQUEST_CHANNEL = "radius:chat-window-request";

export type MainWindowView = "workspace" | "settings" | "agents" | "connectors";

export interface ChatViewState {
  agentId: string | null;
  modelId: string | null;
  thinkingEffortId: string | null;
  scrollTop: number;
  scrollAnchor?: { eventId: string; offset: number };
  atBottom: boolean;
  toolPanelOpen?: boolean;
}

export interface ChatWindowState {
  id: string;
  kind: "main" | "detached";
  sessionIds: string[];
  activeSessionId: string | null;
  requestedView: MainWindowView | null;
  detached: Record<string, string>;
  windows: Array<{ id: string; title: string }>;
  dragging: boolean;
  transferring: boolean;
}

export interface ChatDropZone {
  x: number;
  y: number;
  width: number;
  height: number;
  rows: Array<{ sessionId: string; middle: number }>;
}

export type ChatWindowRequest =
  | { id: string; kind: "capture"; sessionId: string }
  | { id: string; kind: "restore-all"; states: Record<string, ChatViewState> }
  | {
      id: string;
      kind: "prepare";
      sessionId: string;
      state: ChatViewState | null;
    }
  | { id: string; kind: "capture-all" };

export interface ChatWindowApi {
  onError(listener: (message: string) => void): () => void;
  onNavigateMain(listener: (view: MainWindowView) => void): () => void;
  beginRename(sessionId: string): Promise<void>;
  onRename(listener: (sessionId: string) => void): () => void;
  state(): Promise<ChatWindowState>;
  restoreViews(): Promise<void>;
  onChanged(listener: (state: ChatWindowState) => void): () => void;
  onRequest(listener: (request: ChatWindowRequest) => void): () => void;
  reply(
    id: string,
    result: { states?: Record<string, ChatViewState>; error?: string },
  ): Promise<void>;
  move(sessionId: string, windowId: string): Promise<void>;
  detach(sessionId: string): Promise<void>;
  reorder(sessionId: string, direction: "up" | "down"): Promise<void>;
  close(sessionId: string): Promise<void>;
  bringBack(sessionId: string): Promise<void>;
  focus(sessionId: string): Promise<boolean>;
  select(sessionId: string | null): Promise<void>;
  openMain(view?: MainWindowView): Promise<void>;
  setDropZone(zone: ChatDropZone | null): Promise<void>;
  beginDrag(sessionId: string, token: string): Promise<void>;
  endDrag(token: string, cancelled: boolean): Promise<void>;
}
