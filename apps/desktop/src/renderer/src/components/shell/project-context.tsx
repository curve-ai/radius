import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { CreateProjectDialog } from "./create-project-dialog";
import { EditProjectDialog } from "./edit-project-dialog";
import {
  ProjectContext,
  type ProjectContextValue,
  type ProjectSidebarRecord,
  type RecentSessionRecord,
} from "./project-context-value";
import { projectErrorMessage } from "./project-errors";
import { hasUnreadAssistantMessage } from "./session-unread";

const ACTIVE_PROJECT_STORAGE_KEY = "radius:active-project-id";
const ACTIVE_SESSION_STORAGE_KEY = "radius:active-session-id";
const SESSION_READ_AT_STORAGE_KEY = "radius:session-read-at";

function getInitialSessionReadAt(): Record<string, string> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(SESSION_READ_AT_STORAGE_KEY) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && Number.isFinite(Date.parse(entry[1])),
      ),
    );
  } catch {
    return {};
  }
}

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
  const [sessionReadAt, setSessionReadAt] = useState<Record<string, string>>(
    getInitialSessionReadAt,
  );
  const readStateInitializedRef = useRef(
    localStorage.getItem(SESSION_READ_AT_STORAGE_KEY) !== null,
  );

  const updateSessionReadAt = useCallback(
    (updates: Readonly<Record<string, string>>): void => {
      setSessionReadAt((current) => {
        if (
          Object.entries(updates).every(
            ([sessionId, readAt]) => current[sessionId] === readAt,
          )
        ) {
          return current;
        }
        const next = { ...current, ...updates };
        localStorage.setItem(SESSION_READ_AT_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [],
  );

  const loadProjects = useCallback(
    async (showLoading: boolean): Promise<void> => {
      if (showLoading) setLoading(true);
      try {
        const [nextProjects, nextRecents] = await Promise.all([
          window.radius.listProjects(),
          window.radius.listRecentSessions(),
        ]);
        const nextSessions = [
          ...nextProjects.flatMap((project) => project.sessions),
          ...nextRecents,
        ];
        if (!readStateInitializedRef.current) {
          updateSessionReadAt(
            Object.fromEntries(
              nextSessions.flatMap((session) =>
                session.lastAssistantMessageAt
                  ? [[session.id, session.lastAssistantMessageAt]]
                  : [],
              ),
            ),
          );
          readStateInitializedRef.current = true;
        }
        setProjects(nextProjects);
        setRecents(nextRecents);
        const storedSessionId = localStorage.getItem(
          ACTIVE_SESSION_STORAGE_KEY,
        );
        const storedSession = nextSessions.find(
          (session) => session.id === storedSessionId,
        );
        if (storedSession?.lastAssistantMessageAt) {
          updateSessionReadAt({
            [storedSession.id]: storedSession.lastAssistantMessageAt,
          });
        }
        const storedSessionProject = nextProjects.find((project) =>
          project.sessions.some((session) => session.id === storedSessionId),
        );
        const recentSessionActive = nextRecents.some(
          (session) => session.id === storedSessionId,
        );
        setActiveSessionId((current) => {
          const candidate = storedSessionId ?? current;
          const exists =
            nextProjects.some((project) =>
              project.sessions.some((session) => session.id === candidate),
            ) || nextRecents.some((session) => session.id === candidate);
          if (exists) return candidate;
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
        if (showLoading) setLoading(false);
      }
    },
    [updateSessionReadAt],
  );

  const refresh = useCallback(
    async (): Promise<void> => loadProjects(true),
    [loadProjects],
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void loadProjects(true));
    return () => window.cancelAnimationFrame(frame);
  }, [loadProjects]);

  const hasActiveSessions = [...projects, { sessions: recents }].some(
    (project) =>
      project.sessions.some((session) => session.status === "active"),
  );

  useEffect(() => {
    if (!hasActiveSessions) return;
    const timer = window.setInterval(() => void loadProjects(false), 1_500);
    return () => window.clearInterval(timer);
  }, [hasActiveSessions, loadProjects]);

  const selectProject = useCallback((projectId: string): void => {
    setActiveProjectId(projectId);
    localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, projectId);
    setActiveSessionId(null);
    localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
  }, []);

  const selectSession = useCallback(
    (sessionId: string): void => {
      const selectedSession = [
        ...projects.flatMap((project) => project.sessions),
        ...recents,
      ].find((session) => session.id === sessionId);
      if (selectedSession?.lastAssistantMessageAt) {
        updateSessionReadAt({
          [sessionId]: selectedSession.lastAssistantMessageAt,
        });
      }
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
    [projects, recents, updateSessionReadAt],
  );

  const clearActiveSession = useCallback((): void => {
    setActiveSessionId(null);
    localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
  }, []);

  const clearActiveProject = useCallback((): void => {
    setActiveProjectId(null);
    localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
    setActiveSessionId(null);
    localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
  }, []);

  const markSessionsRead = useCallback(
    (sessionIds: readonly string[]): void => {
      const targetIds = new Set(sessionIds);
      const updates = Object.fromEntries(
        [
          ...projects.flatMap((project) => project.sessions),
          ...recents,
        ].flatMap((session) =>
          targetIds.has(session.id) && session.lastAssistantMessageAt
            ? [[session.id, session.lastAssistantMessageAt]]
            : [],
        ),
      );
      updateSessionReadAt(updates);
    },
    [projects, recents, updateSessionReadAt],
  );

  const activateSession = useCallback(
    async (sessionId: string): Promise<void> => {
      localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId);
      await refresh();
    },
    [refresh],
  );

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
        throw cause;
      }
    },
    [refresh],
  );

  const archiveSession = useCallback(
    async (sessionId: string): Promise<void> => {
      try {
        await window.radius.setSessionArchived(sessionId);
        await refresh();
      } catch (cause) {
        setError(projectErrorMessage(cause, "Session could not be archived"));
        throw cause;
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
  const isSessionUnread = useCallback(
    (sessionId: string): boolean => {
      const session = [
        ...projects.flatMap((project) => project.sessions),
        ...recents,
      ].find((candidate) => candidate.id === sessionId);
      return session
        ? hasUnreadAssistantMessage(
            session,
            activeSession?.session.id ?? null,
            sessionReadAt,
          )
        : false;
    },
    [activeSession?.session.id, projects, recents, sessionReadAt],
  );
  const value: ProjectContextValue = {
    activateSession,
    activeProject,
    activeSession,
    archiveSession,
    clearActiveProject,
    clearActiveSession,
    editProject,
    error,
    loading,
    openCreateProjectDialog,
    projects,
    recents,
    isSessionUnread,
    markSessionsRead,
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
