import type { DesktopUpdateStatus } from "./update-types";
import type { ConnectorCatalogEntry } from "@curve-ai/radius-connector-protocol";
import type {
  ConnectorSummary,
  ConnectorEnabledToolSummary,
  SessionTranscriptEventRecord,
} from "@curve-ai/radius-storage";

export type ThemePreference = "system" | "light" | "dark";
export type SessionStatus = "active" | "completed" | "cancelled" | "failed";

export interface ProjectSessionSummary {
  id: string;
  title: string;
  status: SessionStatus;
  updatedAt: string;
  lastAssistantMessageAt: string | null;
  pinnedAt: string | null;
}

export interface ProjectSidebarRecord {
  id: string;
  name: string;
  rootPath: string | null;
  sessions: ProjectSessionSummary[];
}

export type RecentSidebarSession = ProjectSessionSummary;
export type SessionTranscriptEvent = SessionTranscriptEventRecord;
export type DesktopConnector = ConnectorSummary;
export type DesktopConnectorCatalogEntry = ConnectorCatalogEntry;
export type DesktopConnectorEnabledTool = ConnectorEnabledToolSummary;

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
}

export interface CloudConnectionInput {
  frontendUrl: string;
  apiUrl: string;
}

export interface RadiusApi {
  platform: string;
  setNativeTheme(preference: ThemePreference): Promise<boolean>;
  storageStatus(): Promise<{ ready: true }>;
  listProjects(): Promise<ProjectSidebarRecord[]>;
  listRecentSessions(): Promise<RecentSidebarSession[]>;
  listSessionTranscript(sessionId: string): Promise<SessionTranscriptEvent[]>;
  chooseProjectFolder(): Promise<ProjectFolderSelection | null>;
  createProject(input: {
    selectionId: string;
    name: string;
  }): Promise<ProjectSidebarRecord>;
  discardProjectFolderSelection(selectionId: string): Promise<void>;
  relinkProject(projectId: string): Promise<boolean>;
  renameProject(input: { projectId: string; name: string }): Promise<void>;
  revealProject(projectId: string): Promise<void>;
  setSessionPinned(sessionId: string, pinned: boolean): Promise<void>;
  setSessionArchived(sessionId: string): Promise<void>;
  listConnectors(): Promise<DesktopConnector[]>;
  listConnectorTools(
    installationId: string,
  ): Promise<DesktopConnectorEnabledTool[]>;
  listConnectorCatalog(search?: string): Promise<{
    connectors: DesktopConnectorCatalogEntry[];
    nextCursor: string | null;
    protocolVersion: 1;
  }>;
  installCatalogConnector(id: string): Promise<DesktopConnector>;
  installConnector(input: {
    name: string;
    url: string;
  }): Promise<DesktopConnector>;
  disconnectConnector(providerId: string): Promise<void>;
  deleteConnector(installationId: string): Promise<void>;
  listAgents(): Promise<DesktopAgentSummary[]>;
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
