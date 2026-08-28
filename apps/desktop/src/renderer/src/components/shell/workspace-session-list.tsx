import { Archive, Folder, Pin, PinOff, Plus, SquarePen } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useWorkspaceNavigation } from "@renderer/components/shell/navigation-context";
import { type WorkspaceSessionRecord } from "@renderer/components/shell/project-context-value";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@renderer/components/ui/sidebar";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from "@renderer/components/ui/motion";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip";
import { cn } from "@renderer/lib/utils";
import { ProjectActionMenu, RecentsActionMenu } from "./project-action-menu";
import { useProjects } from "./project-context-value";

const PINNED_PROJECTS_STORAGE_KEY = "radius:pinned-project-ids";
const SESSION_ACTION_CLASS =
  "text-muted-foreground/60! transition-[background-color,color,opacity,transform] duration-[80ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:text-foreground! focus-visible:duration-0 active:scale-[0.98] active:duration-100 disabled:opacity-40 group-focus-within/menu-item:opacity-100 group-focus-within/menu-item:duration-0 motion-reduce:active:scale-100 motion-reduce:active:opacity-80 motion-reduce:duration-[60ms] [@media(hover:hover)_and_(pointer:fine)]:md:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:md:group-hover/menu-item:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:md:group-hover/menu-item:duration-100 [&>svg]:size-3!";

type SessionLayoutIntent = {
  sessionId: string;
  kind: "relocate" | "remove";
  duration: 0.16 | 0.18;
};

function getInitialPinnedProjectIds(): Set<string> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(PINNED_PROJECTS_STORAGE_KEY) ?? "[]",
    );
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function SessionSidebarRow({
  active,
  indented = false,
  layoutIntent,
  pending,
  session,
  unread,
  onArchive,
  onSelect,
  onSetPinned,
}: {
  active: boolean;
  indented?: boolean;
  layoutIntent: SessionLayoutIntent | null;
  pending: boolean;
  session: WorkspaceSessionRecord;
  unread: boolean;
  onArchive: (session: WorkspaceSessionRecord) => void;
  onSelect: (sessionId: string) => void;
  onSetPinned: (session: WorkspaceSessionRecord) => void;
}): ReactNode {
  const reduceMotion = useReducedMotion();
  const pinned = session.pinnedAt !== null;
  const pinLabel = pinned ? "Unpin" : "Pin";
  const animateLayout = !reduceMotion && layoutIntent !== null;

  return (
    <motion.li
      initial={false}
      layout={animateLayout ? "position" : false}
      layoutId={
        !reduceMotion &&
        layoutIntent?.kind === "relocate" &&
        layoutIntent.sessionId === session.id
          ? `workspace-session-${session.id}`
          : undefined
      }
      exit={
        reduceMotion
          ? { opacity: 0 }
          : { opacity: 0, transform: "translateX(4px) scale(0.98)" }
      }
      transition={
        reduceMotion
          ? {
              layout: { duration: 0 },
              opacity: { duration: 0.08 },
            }
          : {
              layout: {
                duration: layoutIntent?.duration ?? 0,
                ease: [0.23, 1, 0.32, 1],
              },
              opacity: {
                duration: 0.12,
                ease: [0.23, 1, 0.32, 1],
              },
              transform: {
                duration: 0.12,
                ease: [0.23, 1, 0.32, 1],
              },
            }
      }
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn(
        "group/menu-item relative",
        indented && "ml-7 w-[calc(100%-1.75rem)]",
      )}
    >
      <SidebarMenuButton
        type="button"
        isActive={active}
        aria-current={active ? "page" : undefined}
        className="pr-14! hover:bg-sidebar-accent/55! data-[active=true]:bg-sidebar-accent! data-[active=true]:font-normal md:pr-2! md:group-focus-within/menu-item:pr-14! md:group-hover/menu-item:pr-14!"
        title={session.title}
        onClick={() => onSelect(session.id)}
      >
        <span className="truncate">{session.title}</span>
      </SidebarMenuButton>
      {unread ? (
        <span className="pointer-events-none absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center transition-opacity duration-[80ms] group-focus-within/menu-item:opacity-0 group-hover/menu-item:opacity-0">
          <span className="size-2 rounded-full bg-brand" aria-hidden />
          <span className="sr-only">Unread</span>
        </span>
      ) : null}
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <SidebarMenuAction
            type="button"
            disabled={pending}
            className={`right-7 ${SESSION_ACTION_CLASS}`}
            aria-label={`${pinLabel} ${session.title}`}
            onClick={() => onSetPinned(session)}
          >
            {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
          </SidebarMenuAction>
        </TooltipTrigger>
        <TooltipContent side="top" className="pointer-events-none px-2 py-1">
          {pinLabel}
        </TooltipContent>
      </Tooltip>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <SidebarMenuAction
            type="button"
            disabled={pending}
            className={SESSION_ACTION_CLASS}
            aria-label={`Archive ${session.title}`}
            onClick={() => onArchive(session)}
          >
            <Archive aria-hidden />
          </SidebarMenuAction>
        </TooltipTrigger>
        <TooltipContent side="top" className="pointer-events-none px-2 py-1">
          Archive
        </TooltipContent>
      </Tooltip>
    </motion.li>
  );
}

export function WorkspaceSessionList(): ReactNode {
  const { navigate } = useWorkspaceNavigation();
  const {
    activeProject,
    activeSession,
    archiveSession,
    clearActiveProject,
    editProject,
    error: projectError,
    isSessionUnread,
    loading: projectsLoading,
    markSessionsRead,
    openCreateProjectDialog,
    projects,
    recents,
    revealProject,
    selectProject,
    selectSession,
    setSessionPinned,
  } = useProjects();
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [pinnedProjectIds, setPinnedProjectIds] = useState<Set<string>>(
    getInitialPinnedProjectIds,
  );
  const [recentsExpanded, setRecentsExpanded] = useState(false);
  const [layoutIntent, setLayoutIntent] = useState<SessionLayoutIntent | null>(
    null,
  );
  const [pendingSessionIds, setPendingSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const layoutIntentRef = useRef<SessionLayoutIntent | null>(null);
  const layoutTimerRef = useRef<number | null>(null);

  const clearLayoutIntent = useCallback(() => {
    if (layoutTimerRef.current !== null) {
      window.clearTimeout(layoutTimerRef.current);
      layoutTimerRef.current = null;
    }
    layoutIntentRef.current = null;
    setLayoutIntent(null);
  }, []);

  const beginLayoutIntent = useCallback((intent: SessionLayoutIntent) => {
    if (layoutTimerRef.current !== null) {
      window.clearTimeout(layoutTimerRef.current);
      layoutTimerRef.current = null;
    }
    layoutIntentRef.current = intent;
    setLayoutIntent(intent);
  }, []);

  const settleLayoutIntent = useCallback(() => {
    const intent = layoutIntentRef.current;
    if (!intent) return;
    if (layoutTimerRef.current !== null) {
      window.clearTimeout(layoutTimerRef.current);
    }
    layoutTimerRef.current = window.setTimeout(
      () => {
        if (layoutIntentRef.current === intent) {
          layoutIntentRef.current = null;
          setLayoutIntent(null);
        }
        layoutTimerRef.current = null;
      },
      intent.duration * 1_000 + 80,
    );
  }, []);

  useEffect(() => clearLayoutIntent, [clearLayoutIntent]);

  const runSessionAction = useCallback(
    async (sessionId: string, action: () => Promise<void>) => {
      setPendingSessionIds((current) => new Set(current).add(sessionId));
      try {
        await action();
      } finally {
        setPendingSessionIds((current) => {
          const next = new Set(current);
          next.delete(sessionId);
          return next;
        });
      }
    },
    [],
  );

  const handlePin = useCallback(
    (session: WorkspaceSessionRecord) => {
      beginLayoutIntent({
        sessionId: session.id,
        kind: "relocate",
        duration: 0.18,
      });
      void runSessionAction(session.id, async () => {
        try {
          await setSessionPinned(session.id, session.pinnedAt === null);
          settleLayoutIntent();
        } catch {
          clearLayoutIntent();
        }
      });
    },
    [
      beginLayoutIntent,
      clearLayoutIntent,
      runSessionAction,
      setSessionPinned,
      settleLayoutIntent,
    ],
  );

  const handleArchive = useCallback(
    (session: WorkspaceSessionRecord) => {
      beginLayoutIntent({
        sessionId: session.id,
        kind: "remove",
        duration: 0.16,
      });
      void runSessionAction(session.id, async () => {
        try {
          await archiveSession(session.id);
          settleLayoutIntent();
        } catch {
          clearLayoutIntent();
        }
      });
    },
    [
      archiveSession,
      beginLayoutIntent,
      clearLayoutIntent,
      runSessionAction,
      settleLayoutIntent,
    ],
  );

  const pinnedSessions = useMemo<WorkspaceSessionRecord[]>(
    () =>
      [...projects.flatMap((project) => project.sessions), ...recents]
        .filter((session) => session.pinnedAt !== null)
        .sort(
          (left, right) =>
            Date.parse(right.pinnedAt!) - Date.parse(left.pinnedAt!),
        ),
    [projects, recents],
  );
  const orderedProjects = useMemo(
    () =>
      [...projects].sort(
        (left, right) =>
          Number(pinnedProjectIds.has(right.id)) -
          Number(pinnedProjectIds.has(left.id)),
      ),
    [pinnedProjectIds, projects],
  );
  const recentSessions = useMemo(
    () => recents.filter((session) => session.pinnedAt === null),
    [recents],
  );
  const activeRecentIndex = recentSessions.findIndex(
    (session) => session.id === activeSession?.session.id,
  );
  const showAllRecents = recentsExpanded || activeRecentIndex >= 5;
  const visibleRecents = showAllRecents
    ? recentSessions
    : recentSessions.slice(0, 5);

  const openSession = (sessionId: string): void => {
    selectSession(sessionId);
    navigate("workspace");
  };
  const startProjectChat = (projectId: string): void => {
    selectProject(projectId);
    navigate("workspace");
  };
  const startRecentChat = (): void => {
    clearActiveProject();
    navigate("workspace");
  };
  const toggleProjectPinned = (projectId: string): void => {
    setPinnedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      localStorage.setItem(
        PINNED_PROJECTS_STORAGE_KEY,
        JSON.stringify([...next]),
      );
      return next;
    });
  };
  const renderSession = (
    session: WorkspaceSessionRecord,
    indented = false,
  ): ReactNode => (
    <SessionSidebarRow
      key={session.id}
      active={activeSession?.session.id === session.id}
      indented={indented}
      layoutIntent={layoutIntent}
      pending={pendingSessionIds.has(session.id)}
      session={session}
      unread={isSessionUnread(session.id)}
      onArchive={handleArchive}
      onSelect={openSession}
      onSetPinned={handlePin}
    />
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <LayoutGroup>
        {pinnedSessions.length > 0 ? (
          <SidebarGroup className="pb-0">
            <SidebarGroupLabel>Pinned</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <AnimatePresence initial={false} mode="popLayout">
                  {pinnedSessions.map((session) => renderSession(session))}
                </AnimatePresence>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        <SidebarGroup>
          <SidebarGroupLabel className="font-normal">
            Projects
          </SidebarGroupLabel>
          <SidebarGroupAction
            type="button"
            aria-label="Create project"
            title="Create project"
            disabled={projectsLoading}
            onClick={openCreateProjectDialog}
          >
            <Plus strokeWidth={1.5} aria-hidden />
          </SidebarGroupAction>
          <SidebarGroupContent>
            {projectError && projects.length === 0 ? (
              <p className="px-2 py-1 text-xs leading-relaxed text-negative">
                {projectError}
              </p>
            ) : projectsLoading && projects.length === 0 ? (
              <div className="px-2 py-1 text-xs leading-relaxed text-muted-foreground">
                Loading projects…
              </div>
            ) : projects.length > 0 ? (
              <SidebarMenu>
                {orderedProjects.map((project) => {
                  const unpinnedSessions = project.sessions.filter(
                    (session) => session.pinnedAt === null,
                  );
                  const activeSessionIndex = unpinnedSessions.findIndex(
                    (session) => session.id === activeSession?.session.id,
                  );
                  const expanded =
                    expandedProjectIds.has(project.id) ||
                    activeSessionIndex >= 5;
                  const visibleSessions = expanded
                    ? unpinnedSessions
                    : unpinnedSessions.slice(0, 5);
                  const projectSessionIds = project.sessions.map(
                    (session) => session.id,
                  );
                  const hasUnreadChats = project.sessions.some((session) =>
                    isSessionUnread(session.id),
                  );

                  return (
                    <SidebarMenuItem key={project.id}>
                      <div className="group/project relative">
                        <SidebarMenuButton
                          type="button"
                          isActive={
                            activeProject?.id === project.id && !activeSession
                          }
                          tooltip={project.name}
                          className="pr-[4.5rem] hover:bg-sidebar-accent/55 data-[active=true]:font-normal"
                          onClick={() => {
                            selectProject(project.id);
                            navigate("workspace");
                          }}
                        >
                          <Folder aria-hidden />
                          <span>{project.name}</span>
                        </SidebarMenuButton>
                        <div className="absolute right-1 top-1 flex items-center gap-0.5">
                          <ProjectActionMenu
                            projectName={project.name}
                            hasUnreadChats={hasUnreadChats}
                            pinned={pinnedProjectIds.has(project.id)}
                            revealAvailable={project.rootPath !== null}
                            onEdit={() => editProject(project.id)}
                            onMarkAllRead={() =>
                              markSessionsRead(projectSessionIds)
                            }
                            onReveal={() => void revealProject(project.id)}
                            onTogglePin={() => toggleProjectPinned(project.id)}
                          />
                          <button
                            type="button"
                            aria-label={`New chat in ${project.name}`}
                            title="New chat"
                            className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[background-color,color,opacity] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-sidebar-ring group-hover/project:opacity-100 group-focus-within/project:opacity-100"
                            onClick={() => startProjectChat(project.id)}
                          >
                            <SquarePen
                              className="size-3.5"
                              strokeWidth={1.75}
                              aria-hidden
                            />
                          </button>
                        </div>
                      </div>
                      <SidebarMenu>
                        <AnimatePresence initial={false} mode="popLayout">
                          {visibleSessions.map((session) =>
                            renderSession(session, true),
                          )}
                        </AnimatePresence>
                      </SidebarMenu>
                      {unpinnedSessions.length > 5 ? (
                        <button
                          type="button"
                          className="ml-7 flex h-7 w-[calc(100%-1.75rem)] items-center rounded-md px-2 text-left text-sm text-muted-foreground outline-none hover:bg-sidebar-accent/55 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                          onClick={() =>
                            setExpandedProjectIds((current) => {
                              const next = new Set(current);
                              if (next.has(project.id)) next.delete(project.id);
                              else next.add(project.id);
                              return next;
                            })
                          }
                        >
                          {expanded ? "Show less" : "Show more"}
                        </button>
                      ) : null}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            ) : null}
            {projectError && projects.length > 0 ? (
              <p className="px-2 pt-2 text-xs leading-relaxed text-negative">
                {projectError}
              </p>
            ) : null}
          </SidebarGroupContent>
        </SidebarGroup>

        {recentSessions.length > 0 ? (
          <SidebarGroup className="group/recents pt-0">
            <SidebarGroupLabel className="pr-[4.5rem] font-normal">
              Recents
            </SidebarGroupLabel>
            <div className="absolute right-3 top-3 flex items-center gap-0.5">
              <RecentsActionMenu
                hasUnreadChats={recentSessions.some((session) =>
                  isSessionUnread(session.id),
                )}
                onMarkAllRead={() =>
                  markSessionsRead(recentSessions.map((session) => session.id))
                }
              />
              <button
                type="button"
                aria-label="New standalone chat"
                title="New chat"
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[background-color,color,opacity] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-sidebar-ring group-hover/recents:opacity-100 group-focus-within/recents:opacity-100"
                onClick={startRecentChat}
              >
                <SquarePen
                  className="size-3.5"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </button>
            </div>
            <SidebarGroupContent>
              <SidebarMenu>
                <AnimatePresence initial={false} mode="popLayout">
                  {visibleRecents.map((session) => renderSession(session))}
                </AnimatePresence>
              </SidebarMenu>
              {recentSessions.length > 5 ? (
                <button
                  type="button"
                  className="mt-1 flex h-7 w-full items-center rounded-md px-2 text-left text-sm text-muted-foreground outline-none hover:bg-sidebar-accent/55 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  onClick={() => setRecentsExpanded((current) => !current)}
                >
                  {showAllRecents ? "Show less" : "Show more"}
                </button>
              ) : null}
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </LayoutGroup>
    </div>
  );
}
