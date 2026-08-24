import type { DesktopUpdateStatus } from "./update-types";

export type ThemePreference = "system" | "light" | "dark";
export type SessionStatus = "active" | "completed" | "cancelled" | "failed";

export interface ProjectSessionSummary {
  id: string;
  title: string;
  status: SessionStatus;
  updatedAt: string;
  pinnedAt: string | null;
}

export interface ProjectSidebarRecord {
  id: string;
  name: string;
  rootPath: string | null;
  sessions: ProjectSessionSummary[];
}

export type RecentSidebarSession = ProjectSessionSummary;

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
  syncStatus(): Promise<DesktopSyncStatus>;
  syncNow(): Promise<DesktopSyncStatus>;
  setSyncEnabled(enabled: boolean): Promise<DesktopSyncStatus>;
  connectCloud(input: CloudConnectionInput): Promise<DesktopSyncStatus>;
  updateStatus(): Promise<DesktopUpdateStatus>;
  performUpdate(): Promise<DesktopUpdateStatus>;
  onUpdateStatus(listener: (status: DesktopUpdateStatus) => void): () => void;
}
