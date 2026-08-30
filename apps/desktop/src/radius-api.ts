import type { DesktopUpdateStatus } from "./update-types";
import type {
  ConnectorCatalogEntry,
  ConnectorCatalogCategoryPreview,
  ConnectorCatalogListResponse,
  ConnectorCatalogTaxonomyCategory,
} from "@curve-ai/radius-connector-protocol";
import type {
  ConnectorSummary,
  ConnectorEnabledToolSummary,
  SessionTranscriptEventRecord,
} from "@curve-ai/radius-storage";

export type ThemePreference = "system" | "light" | "dark";
export type SessionStatus = "active" | "completed" | "cancelled" | "failed";

export type NativeControlMenuIcon =
  | "archivebox"
  | "checkmark"
  | "document.on.document"
  | "eye"
  | "folder"
  | "macwindow"
  | "pencil"
  | "pin"
  | "pin.slash"
  | "square.and.arrow.up"
  | "xmark";

interface NativeControlMenuActionItemBase {
  type?: "normal";
  id: string;
  label: string;
  enabled?: boolean;
  icon?: NativeControlMenuIcon;
  toolTip?: string;
  widthHint?: number;
}

export interface NativeControlMenuLeafActionItem extends NativeControlMenuActionItemBase {
  submenu?: never;
}

export type NativeControlMenuLeafItem =
  { type: "separator" } | NativeControlMenuLeafActionItem;

export interface NativeControlMenuSubmenuItem extends NativeControlMenuActionItemBase {
  submenu: NativeControlMenuLeafItem[];
}

export type NativeControlMenuItem =
  NativeControlMenuLeafItem | NativeControlMenuSubmenuItem;

export interface NativeControlMenuPoint {
  x: number;
  y: number;
}

export interface NativeControlMenuInput {
  items: NativeControlMenuItem[];
  point?: NativeControlMenuPoint;
  positioningItem?: number;
}

export interface ProjectSessionSummary {
  id: string;
  title: string;
  status: SessionStatus;
  updatedAt: string;
  lastAssistantMessageAt: string | null;
  pinnedAt: string | null;
  working: boolean;
}

export interface ProjectRootSummary {
  id: string;
  name: string;
  rootPath: string;
}

export interface ProjectSidebarRecord {
  id: string;
  name: string;
  roots: ProjectRootSummary[];
  sessions: ProjectSessionSummary[];
}

export type RecentSidebarSession = ProjectSessionSummary;
type StoredSessionTranscriptMessage = Extract<
  SessionTranscriptEventRecord,
  { eventType: "message" }
>;
export type StreamingSessionTranscriptMessage = Omit<
  StoredSessionTranscriptMessage,
  "status"
> & {
  status: "streaming";
};
export type SessionTranscriptEvent =
  SessionTranscriptEventRecord | StreamingSessionTranscriptMessage;
export interface SessionTranscriptStreamUpdate {
  sessionId: string;
  eventId: string;
  event: Extract<SessionTranscriptEvent, { eventType: "message" }> | null;
  mode: "append" | "replace";
  textOffset?: number;
}
export const SESSION_TRANSCRIPT_STREAM_CHANNEL =
  "radius:session-transcript-stream";
export const AGENTS_CHANGED_CHANNEL = "radius:agents-changed";
export type DesktopConnector = ConnectorSummary;
export type DesktopConnectorCatalogEntry = ConnectorCatalogEntry;
export type DesktopConnectorCatalogCategoryPreview =
  ConnectorCatalogCategoryPreview;
export type DesktopConnectorCatalogCategory = ConnectorCatalogTaxonomyCategory;
export type DesktopConnectorEnabledTool = ConnectorEnabledToolSummary;

export interface DesktopConnectorCatalogQuery {
  category?: string;
  cursor?: string;
  search?: string;
}

export interface ProjectFolderSelection {
  selectionId: string;
  rootPath: string;
  defaultName: string;
}

export interface DesktopSyncStatus {
  state: "disabled" | "idle" | "syncing" | "error";
  providerKey: string | null;
  endpointUrl: string | null;
  lastSuccessAt: string | null;
  errorCode: string | null;
}

export interface DesktopAgentSummary {
  id: string;
  label: string;
  detail?: string;
  models: Array<{
    id: string;
    label: string;
    thinkingEfforts: Array<{ id: string; label: string }>;
    defaultThinkingEffortId: string | null;
  }>;
  defaultModelId: string | null;
  authentication: {
    state:
      | "not_required"
      | "needs_authentication"
      | "connected"
      | "expired"
      | "error";
    label: string | null;
    detail: string;
  };
}

export interface DesktopRuntimeStatus {
  state: "unconfigured" | "ready" | "running" | "error";
  agentId: string | null;
  releaseVersion: string | null;
  errorCode: string | null;
}

export interface BrowserConnectionStatus {
  state:
    "unsupported" | "waiting_for_extension" | "connected" | "paused" | "error";
  extensionId: string;
  profile: { id: string; label: string } | null;
  controlledTabs: number;
  errorCode: string | null;
}

export interface StartAgentPromptInput {
  accessMode: "ask" | "full";
  agentId: string;
  modelId?: string | null;
  prompt: string;
  projectId?: string | null;
  sessionId?: string | null;
  thinkingEffortId?: string | null;
}

export interface StartAgentPromptResult {
  sessionId: string;
  userMessageEventId: string;
}

export interface ResolveTerminalApprovalInput {
  approvalRequestEventId: string;
  decision: "approved" | "denied";
  sessionId: string;
}

export type MarkdownMediaResolution =
  | {
      state: "ready";
      contentType: string;
      dataUrl: string;
      finalUrl: string;
    }
  | {
      state: "blocked";
      reason: "too_large" | "unsafe_url" | "unsupported_type";
    }
  | { state: "unavailable" };

export type MarkdownLinkPreviewResolution =
  | {
      state: "ready";
      description: string | null;
      finalUrl: string;
      imageDataUrl: string | null;
      siteName: string;
      title: string;
    }
  | { state: "blocked"; reason: "unsafe_url" }
  | { state: "unavailable" };

export interface CloudConnectionInput {
  frontendUrl: string;
  apiUrl: string;
}

export interface RadiusApi {
  platform: string;
  setNativeTheme(preference: ThemePreference): Promise<boolean>;
  showNativeControlMenu(input: NativeControlMenuInput): Promise<string | null>;
  writeClipboardText(text: string): Promise<void>;
  storageStatus(): Promise<{ ready: true }>;
  listProjects(): Promise<ProjectSidebarRecord[]>;
  listRecentSessions(): Promise<RecentSidebarSession[]>;
  listSessionTranscript(sessionId: string): Promise<SessionTranscriptEvent[]>;
  onSessionTranscriptStream(
    listener: (update: SessionTranscriptStreamUpdate) => void,
  ): () => void;
  chooseProjectFolder(): Promise<ProjectFolderSelection | null>;
  createProject(input: {
    selectionIds?: string[];
    name: string;
  }): Promise<ProjectSidebarRecord>;
  discardProjectFolderSelection(selectionId: string): Promise<void>;
  addProjectFolder(projectId: string): Promise<ProjectRootSummary | null>;
  removeProjectFolder(input: {
    projectId: string;
    rootId: string;
  }): Promise<void>;
  renameProject(input: { projectId: string; name: string }): Promise<void>;
  renameSession(input: { sessionId: string; title: string }): Promise<void>;
  revealProject(projectId: string): Promise<void>;
  setSessionPinned(sessionId: string, pinned: boolean): Promise<void>;
  setSessionArchived(sessionId: string): Promise<void>;
  listConnectors(): Promise<DesktopConnector[]>;
  listConnectorTools(
    installationId: string,
  ): Promise<DesktopConnectorEnabledTool[]>;
  listConnectorCatalog(
    query?: DesktopConnectorCatalogQuery,
  ): Promise<ConnectorCatalogListResponse>;
  installCatalogConnector(id: string): Promise<DesktopConnector>;
  installConnector(input: {
    name: string;
    url: string;
  }): Promise<DesktopConnector>;
  disconnectConnector(providerId: string): Promise<void>;
  deleteConnector(installationId: string): Promise<void>;
  listAgents(): Promise<DesktopAgentSummary[]>;
  onAgentsChanged(listener: () => void): () => void;
  connectAgentAuthentication(agentId: string): Promise<DesktopAgentSummary>;
  disconnectAgentAuthentication(agentId: string): Promise<DesktopAgentSummary>;
  runtimeStatus(): Promise<DesktopRuntimeStatus>;
  browserStatus(): Promise<BrowserConnectionStatus>;
  revealBrowserExtension(): Promise<boolean>;
  onBrowserStatus(
    listener: (status: BrowserConnectionStatus) => void,
  ): () => void;
  startAgentPrompt(
    input: StartAgentPromptInput,
  ): Promise<StartAgentPromptResult>;
  resolveTerminalApproval(input: ResolveTerminalApprovalInput): Promise<void>;
  resolveMarkdownMedia(url: string): Promise<MarkdownMediaResolution>;
  resolveMarkdownLinkPreview(
    url: string,
  ): Promise<MarkdownLinkPreviewResolution>;
  cancelAgentSession(sessionId: string): Promise<void>;
  syncStatus(): Promise<DesktopSyncStatus>;
  syncNow(): Promise<DesktopSyncStatus>;
  setSyncEnabled(enabled: boolean): Promise<DesktopSyncStatus>;
  connectCloud(input: CloudConnectionInput): Promise<DesktopSyncStatus>;
  updateStatus(): Promise<DesktopUpdateStatus>;
  checkForUpdates(): Promise<DesktopUpdateStatus>;
  performUpdate(): Promise<DesktopUpdateStatus>;
  onUpdateStatus(listener: (status: DesktopUpdateStatus) => void): () => void;
}
