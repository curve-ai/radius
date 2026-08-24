import { useCallback, useEffect, useState, type ReactNode } from "react";

import { CreateProjectDialog } from "./create-project-dialog";
import { EditProjectDialog } from "./edit-project-dialog";
import {
  ProjectContext,
  type ProjectContextValue,
  type ProjectSidebarRecord,
  type RecentSessionRecord,
} from "./project-context-value";
import { projectErrorMessage } from "./project-errors";

const ACTIVE_PROJECT_STORAGE_KEY = "radius:active-project-id";
const ACTIVE_SESSION_STORAGE_KEY = "radius:active-session-id";

export function ProjectProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [projects, setProjects] = useState<ProjectSidebarRecord[]>([]);
  const [recents, setRecents] = useState<RecentSessionRecord[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() =>
    localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY),
  );
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() =>
    localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [nextProjects, nextRecents] = await Promise.all([
        window.radius.listProjects(),
        window.radius.listRecentSessions(),
      ]);
      setProjects(nextProjects);
      setRecents(nextRecents);
      const storedSessionId = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
      const storedSessionProject = nextProjects.find((project) =>
        project.sessions.some((session) => session.id === storedSessionId),
      );
      const recentSessionActive = nextRecents.some(
        (session) => session.id === storedSessionId,
      );
      setActiveSessionId((current) => {
        const exists =
          nextProjects.some((project) =>
            project.sessions.some((session) => session.id === current),
          ) || nextRecents.some((session) => session.id === current);
        if (exists) return current;
        localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
        return null;
      });
      setActiveProjectId((current) => {
        if (recentSessionActive) {
          localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
          return null;
        }
        const next =
          storedSessionProject?.id ??
          (nextProjects.some((project) => project.id === current)
            ? current
            : (nextProjects[0]?.id ?? null));
        if (next) localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, next);
        else localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
        return next;
      });
      setError(null);
    } catch (cause) {
      setError(projectErrorMessage(cause, "Projects could not be loaded"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void refresh());
    return () => window.cancelAnimationFrame(frame);
  }, [refresh]);

  const selectProject = useCallback((projectId: string): void => {
    setActiveProjectId(projectId);
    localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, projectId);
    setActiveSessionId(null);
    localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
  }, []);

  const selectSession = useCallback(
    (sessionId: string): void => {
      const projectId =
        projects.find((project) =>
          project.sessions.some((session) => session.id === sessionId),
        )?.id ?? null;
      setActiveProjectId(projectId);
      setActiveSessionId(sessionId);
      if (projectId)
        localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, projectId);
      else localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
      localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId);
    },
    [projects],
  );

  const clearActiveSession = useCallback((): void => {
    setActiveSessionId(null);
    localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
  }, []);

  const openCreateProjectDialog = useCallback((): void => {
    setCreateProjectOpen(true);
  }, []);

  const editProject = useCallback((projectId: string): void => {
    setEditingProjectId(projectId);
  }, []);

  const handleProjectCreated = useCallback(
    async (project: ProjectSidebarRecord) => {
      selectProject(project.id);
      await refresh();
    },
    [refresh, selectProject],
  );

  const relinkProject = useCallback(
    async (projectId: string): Promise<boolean> => {
      try {
        const linked = await window.radius.relinkProject(projectId);
        if (linked) await refresh();
        return linked;
      } catch (cause) {
        setError(
          projectErrorMessage(cause, "Project folder could not be linked"),
        );
        throw cause;
      }
    },
    [refresh],
  );

  const revealProject = useCallback(
    async (projectId: string): Promise<void> => {
      try {
        await window.radius.revealProject(projectId);
      } catch (cause) {
        setError(projectErrorMessage(cause, "Project could not be revealed"));
      }
    },
    [],
  );

  const setSessionPinned = useCallback(
    async (sessionId: string, pinned: boolean): Promise<void> => {
      try {
        await window.radius.setSessionPinned(sessionId, pinned);
        await refresh();
      } catch (cause) {
        setError(
          projectErrorMessage(cause, "Pinned state could not be updated"),
        );
      }
    },
    [refresh],
  );

  const editingProject =
    projects.find((project) => project.id === editingProjectId) ?? null;
  const activeSession = (() => {
    for (const project of projects) {
      const session = project.sessions.find(
        (candidate) => candidate.id === activeSessionId,
      );
      if (session) return { project, session };
    }
    const recentSession = recents.find(
      (candidate) => candidate.id === activeSessionId,
    );
    return recentSession ? { project: null, session: recentSession } : null;
  })();
  const activeProject =
    activeSession?.project ??
    projects.find((project) => project.id === activeProjectId) ??
    null;
  const value: ProjectContextValue = {
    activeProject,
    activeSession,
    clearActiveSession,
    editProject,
    error,
    loading,
    openCreateProjectDialog,
    projects,
    recents,
    refresh,
    relinkProject,
    revealProject,
    selectProject,
    selectSession,
    setSessionPinned,
  };

  return (
    <ProjectContext.Provider value={value}>
      {children}
      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        onCreated={handleProjectCreated}
      />
      {editingProject && (
        <EditProjectDialog
          key={editingProject.id}
          open
          project={editingProject}
          onOpenChange={(open) => {
            if (!open) setEditingProjectId(null);
          }}
          onRelink={relinkProject}
          onSaved={refresh}
        />
      )}
    </ProjectContext.Provider>
  );
}
