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
  activeProject: ProjectSidebarRecord | null;
  activeSession: ActiveProjectSession | null;
  clearActiveSession(): void;
  editProject(projectId: string): void;
  error: string | null;
  loading: boolean;
  openCreateProjectDialog(): void;
  projects: ProjectSidebarRecord[];
  recents: RecentSessionRecord[];
  refresh(): Promise<void>;
  relinkProject(projectId: string): Promise<boolean>;
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
