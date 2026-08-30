import {
  Archive,
  ChevronRight,
  Folder,
  LoaderCircle,
  Pin,
  PinOff,
  Plus,
  SquarePen,
} from "lucide-react";
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
  ActionToolPanelButton,
  ActionToolPanelItemContent,
  ActionToolPanelItemIcon,
  ActionToolPanelItemLabel,
} from "@renderer/components/ui/action-tool-panel";
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
import type { NativeControlMenuPoint } from "../../../../radius-api";
import { ProjectActionMenu, RecentsActionMenu } from "./project-action-menu";
import {
  showProjectActionMenu,
  showRecentsActionMenu,
  type ProjectActionMenuOptions,
  type RecentsActionMenuOptions,
} from "./project-action-menu-actions";
import { useProjects } from "./project-context-value";
import { showSessionActionMenu } from "./session-action-menu-actions";

const PINNED_PROJECTS_STORAGE_KEY = "radius:pinned-project-ids";
const SESSION_ACTION_CLASS =
  "text-muted-foreground/60! transition-[background-color,color,opacity,transform] duration-[80ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:text-foreground! focus-visible:duration-0 active:scale-[0.98] active:duration-100 disabled:opacity-40 group-focus-within/menu-item:opacity-100 group-focus-within/menu-item:duration-0 motion-reduce:active:scale-100 motion-reduce:active:opacity-80 motion-reduce:duration-[60ms] [@media(hover:hover)_and_(pointer:fine)]:md:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:md:group-hover/menu-item:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:md:group-hover/menu-item:duration-100 [&>svg]:size-3!";

type SessionLayoutIntent = {
  sessionId: string;
  kind: "relocate" | "remove";
  duration: 0.16 | 0.18;
};

function toggleSetValue<T>(current: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

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
  onOpenMenu,
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
  onOpenMenu: (
    session: WorkspaceSessionRecord,
    point: NativeControlMenuPoint,
  ) => void;
  onSelect: (sessionId: string) => void;
  onSetPinned: (session: WorkspaceSessionRecord) => void;
}): ReactNode {
  const reduceMotion = useReducedMotion();
  const pinned = session.pinnedAt !== null;
  const pinLabel = pinned ? "Unpin" : "Pin";
  const animateLayout = !reduceMotion && layoutIntent !== null;
  const hasTrailingStatus = session.working || unread;

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
      className="group/menu-item relative w-full"
    >
      <SidebarMenuButton
        type="button"
        isActive={active}
        aria-current={active ? "page" : undefined}
        className={cn(
          "pr-14! hover:bg-sidebar-accent/55! data-[active=true]:bg-sidebar-accent! data-[active=true]:font-normal md:pr-2! md:group-focus-within/menu-item:pr-14! md:group-hover/menu-item:pr-14!",
          indented && "pl-9!",
          hasTrailingStatus && "md:pr-8!",
        )}
        title={session.title}
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenMenu(session, { x: event.clientX, y: event.clientY });
        }}
        onClick={() => onSelect(session.id)}
      >
        <span className="truncate">{session.title}</span>
      </SidebarMenuButton>
      {hasTrailingStatus ? (
        <span className="pointer-events-none absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center transition-opacity duration-[80ms] group-focus-within/menu-item:opacity-0 group-hover/menu-item:opacity-0">
          {session.working ? (
            <LoaderCircle
              className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
              strokeWidth={1.75}
              aria-hidden
            />
          ) : (
            <span className="size-2 rounded-full bg-brand" aria-hidden />
          )}
          <span className="sr-only">
            {session.working ? "Working" : "Unread"}
          </span>
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
  const { activeView, navigate } = useWorkspaceNavigation();
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
    markSessionsUnread,
    openCreateProjectDialog,
    projects,
    recents,
    requestSessionRename,
    revealProject,
    selectProject,
    selectSession,
    setSessionPinned,
  } = useProjects();
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [pinnedProjectIds, setPinnedProjectIds] = useState<Set<string>>(
    getInitialPinnedProjectIds,
  );
  const [recentsExpanded, setRecentsExpanded] = useState(false);
  const [recentsCollapsed, setRecentsCollapsed] = useState(false);
  const [openControlMenuId, setOpenControlMenuId] = useState<string | null>(
    null,
  );
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

  const setControlMenuOpen = useCallback(
    (menuId: string, open: boolean): void => {
      setOpenControlMenuId((current) =>
        open ? menuId : current === menuId ? null : current,
      );
    },
    [],
  );

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
      const next = toggleSetValue(current, projectId);
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
      active={
        activeView === "workspace" && activeSession?.session.id === session.id
      }
      indented={indented}
      layoutIntent={layoutIntent}
      pending={pendingSessionIds.has(session.id)}
      session={session}
      unread={isSessionUnread(session.id)}
      onArchive={handleArchive}
      onOpenMenu={openSessionActionMenu}
      onSelect={openSession}
      onSetPinned={handlePin}
    />
  );
  const runControlMenu = (
    menuId: string,
    showMenu: () => Promise<void>,
  ): void => {
    setControlMenuOpen(menuId, true);
    void showMenu()
      .catch(() => undefined)
      .finally(() => setControlMenuOpen(menuId, false));
  };
  const openSessionActionMenu = (
    session: WorkspaceSessionRecord,
    point: NativeControlMenuPoint,
  ): void => {
    const project = projects.find((candidate) =>
      candidate.sessions.some((item) => item.id === session.id),
    );
    runControlMenu(`session:${session.id}`, () =>
      showSessionActionMenu(
        {
          canMarkUnread: session.lastAssistantMessageAt !== null,
          pinned: session.pinnedAt !== null,
          sessionId: session.id,
          title: session.title,
          workingDirectories: project?.roots.map((root) => root.rootPath) ?? [],
          onArchive: () => handleArchive(session),
          onMarkUnread: () => markSessionsUnread([session.id]),
          onRename: () => {
            openSession(session.id);
            requestSessionRename(session.id);
          },
          onTogglePin: () => handlePin(session),
        },
        point,
      ),
    );
  };
  const recentsActionMenuOptions: RecentsActionMenuOptions = {
    hasUnreadChats: recentSessions.some((session) =>
      isSessionUnread(session.id),
    ),
    onMarkAllRead: () =>
      markSessionsRead(recentSessions.map((session) => session.id)),
  };
  const openRecentsActionMenu = (point: NativeControlMenuPoint): void => {
    runControlMenu("recents", () =>
      showRecentsActionMenu(recentsActionMenuOptions, point),
    );
  };

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
                  const collapsed = collapsedProjectIds.has(project.id);
                  const projectActive =
                    activeProject?.id === project.id && !activeSession;
                  const sessionsId = `project-${project.id}-sessions`;
                  const controlMenuId = `project:${project.id}`;
                  const projectActionMenuOptions: ProjectActionMenuOptions = {
                    pinned: pinnedProjectIds.has(project.id),
                    rootCount: project.roots.length,
                    onEdit: () => editProject(project.id),
                    onReveal: () => void revealProject(project.id),
                    onTogglePin: () => toggleProjectPinned(project.id),
                  };
                  const openProjectActionMenu = (
                    point: NativeControlMenuPoint,
                  ): void => {
                    runControlMenu(controlMenuId, () =>
                      showProjectActionMenu(projectActionMenuOptions, point),
                    );
                  };

                  return (
                    <SidebarMenuItem key={project.id}>
                      <div className="group/control-box-target group/project relative">
                        <ActionToolPanelButton
                          type="button"
                          aria-expanded={!collapsed}
                          aria-controls={sessionsId}
                          aria-current={projectActive ? "page" : undefined}
                          data-active={projectActive}
                          className="min-h-8 gap-2 rounded-md py-1 pr-[4.5rem] hover:bg-sidebar-accent/55 focus-visible:bg-sidebar-accent/55 focus-visible:ring-sidebar-ring data-[active=true]:bg-sidebar-accent"
                          onContextMenu={(event) => {
                            event.preventDefault();
                            openProjectActionMenu({
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                          onClick={() => {
                            setCollapsedProjectIds((current) =>
                              toggleSetValue(current, project.id),
                            );
                          }}
                        >
                          <ActionToolPanelItemIcon className="size-5 text-sidebar-foreground [&_svg]:size-3.5">
                            <Folder aria-hidden />
                          </ActionToolPanelItemIcon>
                          <ActionToolPanelItemContent className="flex items-center gap-1">
                            <ActionToolPanelItemLabel className="truncate text-sidebar-foreground">
                              {project.name}
                            </ActionToolPanelItemLabel>
                            <ChevronRight
                              className={cn(
                                "size-3.5! shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] duration-100 group-hover/action-tool-button:opacity-100 group-focus-visible/action-tool-button:opacity-100 motion-reduce:transition-none",
                                !collapsed && "rotate-90",
                              )}
                              strokeWidth={1.75}
                              aria-hidden
                            />
                          </ActionToolPanelItemContent>
                        </ActionToolPanelButton>
                        <div className="absolute inset-y-1 right-1 flex items-center gap-1">
                          <ProjectActionMenu
                            open={openControlMenuId === controlMenuId}
                            projectName={project.name}
                            onOpen={openProjectActionMenu}
                          />
                          <button
                            type="button"
                            aria-label={`New chat in ${project.name}`}
                            title="New chat"
                            className="flex size-5 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[background-color,color,opacity] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-sidebar-ring group-hover/project:opacity-100 group-focus-within/project:opacity-100"
                            onClick={() => startProjectChat(project.id)}
                          >
                            <SquarePen
                              className="size-3"
                              strokeWidth={1.75}
                              aria-hidden
                            />
                          </button>
                        </div>
                      </div>
                      <div id={sessionsId} hidden={collapsed}>
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
                            className="flex h-7 w-full items-center rounded-md pl-9 pr-2 text-left text-sm text-muted-foreground outline-none hover:bg-sidebar-accent/55 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                            onClick={() =>
                              setExpandedProjectIds((current) =>
                                toggleSetValue(current, project.id),
                              )
                            }
                          >
                            {expanded ? "Show less" : "Show more"}
                          </button>
                        ) : null}
                      </div>
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
          <SidebarGroup className="group/control-box-target group/recents pt-0">
            <div className="relative">
              <ActionToolPanelButton
                type="button"
                aria-expanded={!recentsCollapsed}
                aria-controls="recent-sessions"
                className="min-h-8 gap-2 rounded-md py-1 pr-[4.5rem] hover:bg-sidebar-accent/55 focus-visible:bg-sidebar-accent/55 focus-visible:ring-sidebar-ring"
                onContextMenu={(event) => {
                  event.preventDefault();
                  openRecentsActionMenu({
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                onClick={() => setRecentsCollapsed((current) => !current)}
              >
                <ActionToolPanelItemContent className="flex items-center gap-1">
                  <ActionToolPanelItemLabel className="text-xs text-sidebar-foreground/70">
                    Recents
                  </ActionToolPanelItemLabel>
                  <ChevronRight
                    className={cn(
                      "size-3.5! shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] duration-100 group-hover/action-tool-button:opacity-100 group-focus-visible/action-tool-button:opacity-100 motion-reduce:transition-none",
                      !recentsCollapsed && "rotate-90",
                    )}
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </ActionToolPanelItemContent>
              </ActionToolPanelButton>
              <div className="absolute inset-y-1 right-1 flex items-center gap-1">
                <RecentsActionMenu
                  open={openControlMenuId === "recents"}
                  onOpen={openRecentsActionMenu}
                />
                <button
                  type="button"
                  aria-label="New standalone chat"
                  title="New chat"
                  className="flex size-5 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[background-color,color,opacity] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-sidebar-ring group-hover/recents:opacity-100 group-focus-within/recents:opacity-100"
                  onClick={startRecentChat}
                >
                  <SquarePen
                    className="size-3.5"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </button>
              </div>
            </div>
            <SidebarGroupContent id="recent-sessions" hidden={recentsCollapsed}>
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
