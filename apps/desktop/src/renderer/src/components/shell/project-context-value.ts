import { createContext, useContext } from "react";

import type {
  ProjectSidebarRecord,
  RecentSidebarSession,
} from "../../../../radius-api";

export type { ProjectSidebarRecord } from "../../../../radius-api";

export type ProjectSessionRecord = ProjectSidebarRecord["sessions"][number];
export type RecentSessionRecord = RecentSidebarSession;
export type WorkspaceSessionRecord = ProjectSessionRecord | RecentSessionRecord;

export interface ActiveProjectSession {
  project: ProjectSidebarRecord | null;
  session: WorkspaceSessionRecord;
}

export interface ProjectContextValue {
  activateSession(sessionId: string): Promise<void>;
  addProjectFolder(projectId: string): Promise<void>;
  activeProject: ProjectSidebarRecord | null;
  activeSession: ActiveProjectSession | null;
  archiveSession(sessionId: string): Promise<void>;
  clearActiveProject(): void;
  clearActiveSession(): void;
  clearSessionRenameRequest(sessionId: string): void;
  editProject(projectId: string): void;
  error: string | null;
  loading: boolean;
  openCreateProjectDialog(): void;
  projects: ProjectSidebarRecord[];
  recents: RecentSessionRecord[];
  isSessionUnread(sessionId: string): boolean;
  markSessionsRead(sessionIds: readonly string[]): void;
  markSessionsUnread(sessionIds: readonly string[]): void;
  refresh(): Promise<void>;
  requestSessionRename(sessionId: string): void;
  removeProjectFolder(projectId: string, rootId: string): Promise<void>;
  renameSession(sessionId: string, title: string): Promise<void>;
  sessionRenameRequestId: string | null;
  revealProject(projectId: string): Promise<void>;
  selectProject(projectId: string): void;
  selectSession(sessionId: string): void;
  setSessionPinned(sessionId: string, pinned: boolean): Promise<void>;
}

export const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProjects(): ProjectContextValue {
  const context = useContext(ProjectContext);
  if (!context)
    throw new Error("useProjects must be used within ProjectProvider");
  return context;
}
