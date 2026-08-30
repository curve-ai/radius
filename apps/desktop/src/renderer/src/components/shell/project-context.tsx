import {
  useCallback,
  useEffect,
  useMemo,
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
  const [sessionRenameRequestId, setSessionRenameRequestId] = useState<
    string | null
  >(null);
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

  const markSessionsUnread = useCallback(
    (sessionIds: readonly string[]): void => {
      const targetIds = new Set(sessionIds);
      setSessionReadAt((current) => {
        if (![...targetIds].some((sessionId) => sessionId in current)) {
          return current;
        }
        const next = { ...current };
        for (const sessionId of targetIds) delete next[sessionId];
        localStorage.setItem(SESSION_READ_AT_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [],
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

  const requestSessionRename = useCallback((sessionId: string): void => {
    setSessionRenameRequestId(sessionId);
  }, []);

  const clearSessionRenameRequest = useCallback((sessionId: string): void => {
    setSessionRenameRequestId((current) =>
      current === sessionId ? null : current,
    );
  }, []);

  const handleProjectCreated = useCallback(
    async (project: ProjectSidebarRecord) => {
      selectProject(project.id);
      await refresh();
    },
    [refresh, selectProject],
  );

  const addProjectFolder = useCallback(
    async (projectId: string): Promise<void> => {
      try {
        const root = await window.radius.addProjectFolder(projectId);
        if (root) await refresh();
      } catch (cause) {
        setError(
          projectErrorMessage(cause, "Project folder could not be added"),
        );
        throw cause;
      }
    },
    [refresh],
  );

  const removeProjectFolder = useCallback(
    async (projectId: string, rootId: string): Promise<void> => {
      try {
        await window.radius.removeProjectFolder({ projectId, rootId });
        await refresh();
      } catch (cause) {
        setError(
          projectErrorMessage(cause, "Project folder could not be removed"),
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

  const renameSession = useCallback(
    async (sessionId: string, title: string): Promise<void> => {
      try {
        await window.radius.renameSession({ sessionId, title });
        await refresh();
      } catch (cause) {
        setError(projectErrorMessage(cause, "Session could not be renamed"));
        throw cause;
      }
    },
    [refresh],
  );

  const editingProject =
    projects.find((project) => project.id === editingProjectId) ?? null;
  const sessionsById = useMemo(() => {
    const sessions = new Map<
      string,
      NonNullable<ProjectContextValue["activeSession"]>
    >();
    for (const project of projects) {
      for (const session of project.sessions) {
        sessions.set(session.id, { project, session });
      }
    }
    for (const session of recents) {
      if (!sessions.has(session.id))
        sessions.set(session.id, { project: null, session });
    }
    return sessions;
  }, [projects, recents]);
  const activeSession = activeSessionId
    ? (sessionsById.get(activeSessionId) ?? null)
    : null;
  const activeProject =
    activeSession?.project ??
    projects.find((project) => project.id === activeProjectId) ??
    null;
  const isSessionUnread = useCallback(
    (sessionId: string): boolean => {
      const entry = sessionsById.get(sessionId);
      return entry
        ? hasUnreadAssistantMessage(
            entry.session,
            activeSession?.session.id ?? null,
            sessionReadAt,
          )
        : false;
    },
    [activeSession?.session.id, sessionReadAt, sessionsById],
  );
  const value: ProjectContextValue = {
    activateSession,
    addProjectFolder,
    activeProject,
    activeSession,
    archiveSession,
    clearActiveProject,
    clearActiveSession,
    clearSessionRenameRequest,
    editProject,
    error,
    loading,
    openCreateProjectDialog,
    projects,
    recents,
    isSessionUnread,
    markSessionsRead,
    markSessionsUnread,
    refresh,
    requestSessionRename,
    removeProjectFolder,
    renameSession,
    sessionRenameRequestId,
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
          onAddFolder={addProjectFolder}
          onOpenChange={(open) => {
            if (!open) setEditingProjectId(null);
          }}
          onRemoveFolder={removeProjectFolder}
          onSaved={refresh}
        />
      )}
    </ProjectContext.Provider>
  );
}
