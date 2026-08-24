import {
  Clock3,
  Folder,
  Pin,
  PinOff,
  Plus,
  Plug,
  Search,
  SquarePen,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { useWorkspaceNavigation } from "@renderer/components/shell/navigation-context";
import { type WorkspaceSessionRecord } from "@renderer/components/shell/project-context-value";
import { UserAvatar } from "@renderer/components/shell/user-avatar";
import { Button } from "@renderer/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@renderer/components/ui/sidebar";
import { Wordmark } from "@renderer/components/ui/wordmark";
import { cn } from "@renderer/lib/utils";
import { DesktopUpdateAction } from "./desktop-update-action";
import { useProjects } from "./project-context-value";
import { ProjectActionMenu } from "./project-action-menu";
import { SessionStatus } from "./session-status";
import { useStartNewChat } from "./use-start-new-chat";
import {
  clampWorkspaceSidebarWidth,
  WORKSPACE_SIDEBAR_MAX_WIDTH,
  WORKSPACE_SIDEBAR_MIN_WIDTH,
} from "./workspace-sidebar-width";

const navigationItems = [
  {
    view: "workspace",
    label: "New chat",
    icon: SquarePen,
    showsActiveState: false,
  },
  {
    view: "scheduled",
    label: "Scheduled",
    icon: Clock3,
    showsActiveState: true,
  },
  {
    view: "plugins",
    label: "Plugins",
    icon: Plug,
    showsActiveState: true,
  },
] as const;

const PINNED_PROJECTS_STORAGE_KEY = "radius:pinned-project-ids";

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

type SidebarResizeState = {
  pointerId: number;
  startX: number;
  startWidth: number;
  latestWidth: number;
  previousCursor: string;
  previousResizing: string | undefined;
  previousUserSelect: string;
};

function SessionSidebarRow({
  active,
  indented = false,
  session,
  onSelect,
  onSetPinned,
}: {
  active: boolean;
  indented?: boolean;
  session: WorkspaceSessionRecord;
  onSelect: (sessionId: string) => void;
  onSetPinned: (sessionId: string, pinned: boolean) => void;
}): ReactNode {
  const pinned = session.pinnedAt !== null;
  const actionLabel = pinned ? "Unpin" : "Pin";

  return (
    <SidebarMenuItem className={cn(indented && "ml-7 w-[calc(100%-1.75rem)]")}>
      <SidebarMenuButton
        type="button"
        isActive={active}
        aria-current={active ? "page" : undefined}
        className="hover:bg-sidebar-accent/55 data-[active=true]:font-normal"
        title={session.title}
        onClick={() => onSelect(session.id)}
      >
        <span className="truncate">{session.title}</span>
        <SessionStatus status={session.status} className="ml-auto" />
      </SidebarMenuButton>
      <SidebarMenuAction
        type="button"
        showOnHover
        aria-label={`${actionLabel} ${session.title}`}
        title={actionLabel}
        onClick={() => onSetPinned(session.id, !pinned)}
      >
        {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}

function WorkspaceSidebarResizeEdge({
  width,
  onWidthChange,
  onWidthCommit,
}: {
  width: number;
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
}): ReactNode {
  const resizeStateRef = useRef<SidebarResizeState | null>(null);

  const finishResize = useCallback(() => {
    const resizeState = resizeStateRef.current;
    if (!resizeState) return;

    document.body.style.cursor = resizeState.previousCursor;
    document.body.style.userSelect = resizeState.previousUserSelect;
    if (resizeState.previousResizing === undefined) {
      delete document.documentElement.dataset.sidebarResizing;
    } else {
      document.documentElement.dataset.sidebarResizing =
        resizeState.previousResizing;
    }
    onWidthCommit(resizeState.latestWidth);
    resizeStateRef.current = null;
  }, [onWidthCommit]);

  useEffect(() => finishResize, [finishResize]);

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    if (event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      latestWidth: width,
      previousCursor: document.body.style.cursor,
      previousResizing: document.documentElement.dataset.sidebarResizing,
      previousUserSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.documentElement.dataset.sidebarResizing = "true";
  };

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;

    const nextWidth = clampWorkspaceSidebarWidth(
      resizeState.startWidth + event.clientX - resizeState.startX,
    );
    resizeState.latestWidth = nextWidth;
    onWidthChange(nextWidth);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 32 : 16;
    let nextWidth: number | null = null;

    if (event.key === "ArrowLeft") nextWidth = width - step;
    if (event.key === "ArrowRight") nextWidth = width + step;
    if (event.key === "Home") nextWidth = WORKSPACE_SIDEBAR_MIN_WIDTH;
    if (event.key === "End") nextWidth = WORKSPACE_SIDEBAR_MAX_WIDTH;
    if (nextWidth === null) return;

    event.preventDefault();
    const clampedWidth = clampWorkspaceSidebarWidth(nextWidth);
    onWidthChange(clampedWidth);
    onWidthCommit(clampedWidth);
  };

  return (
    <div
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemin={WORKSPACE_SIDEBAR_MIN_WIDTH}
      aria-valuemax={WORKSPACE_SIDEBAR_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      className="electron-window-no-drag absolute inset-y-0 -right-1 z-30 hidden w-2 cursor-col-resize touch-none outline-none focus-visible:bg-sidebar-ring/40 md:block"
      onKeyDown={handleKeyDown}
      onLostPointerCapture={finishResize}
      onPointerCancel={finishResize}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishResize}
    />
  );
}

export function WorkspaceSidebar({
  width,
  onWidthChange,
  onWidthCommit,
  onSearch,
}: {
  width: number;
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
  onSearch: () => void;
}): ReactNode {
  const { activeView, navigate } = useWorkspaceNavigation();
  const {
    activeProject,
    activeSession,
    editProject,
    error: projectError,
    loading: projectsLoading,
    openCreateProjectDialog,
    projects,
    recents,
    revealProject,
    selectProject,
    selectSession,
    setSessionPinned,
  } = useProjects();
  const startNewChat = useStartNewChat();
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [pinnedProjectIds, setPinnedProjectIds] = useState<Set<string>>(
    getInitialPinnedProjectIds,
  );
  const [recentsExpanded, setRecentsExpanded] = useState(false);
  const { isMobile, state } = useSidebar();
  const desktopCollapsed = !isMobile && state === "collapsed";
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
  const openSession = (sessionId: string): void => {
    selectSession(sessionId);
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

  return (
    <Sidebar collapsible="offcanvas" className="fixed inset-y-0 z-50 h-dvh">
      <div className="electron-window-drag absolute inset-x-0 top-0 h-10" />
      <div
        className="radius-sidebar-material relative flex h-full w-full flex-col"
        aria-hidden={desktopCollapsed || undefined}
        inert={desktopCollapsed || undefined}
      >
        <SidebarHeader className="relative z-10 h-[5.25rem] shrink-0 justify-end px-2 pb-2 pt-8">
          <div className="flex h-8 items-center gap-1">
            <button
              type="button"
              className="electron-window-no-drag flex h-8 min-w-0 flex-1 items-center px-2 text-left"
              title="Go to workspace"
              onClick={startNewChat}
            >
              <Wordmark size="sm" className="-translate-y-px" />
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Search"
              title="Search"
              className="electron-window-no-drag size-7 shrink-0 rounded-md text-muted-foreground hover:text-sidebar-accent-foreground"
              onClick={onSearch}
            >
              <Search className="size-3.5" aria-hidden />
            </Button>
          </div>
        </SidebarHeader>

        <SidebarContent className="overflow-hidden">
          <SidebarGroup className="shrink-0 pt-1">
            <SidebarGroupContent>
              <nav aria-label="Primary">
                <SidebarMenu>
                  {navigationItems.map((item) => {
                    const isActive =
                      item.showsActiveState && activeView === item.view;

                    return (
                      <SidebarMenuItem key={item.view}>
                        <SidebarMenuButton
                          type="button"
                          isActive={isActive}
                          tooltip={item.label}
                          className="focus-visible:ring-0 focus-visible:ring-offset-0 data-[active=true]:font-normal"
                          aria-current={isActive ? "page" : undefined}
                          onClick={() => {
                            if (item.view === "workspace") startNewChat();
                            else navigate(item.view);
                          }}
                        >
                          <item.icon aria-hidden />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </nav>
            </SidebarGroupContent>
          </SidebarGroup>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {pinnedSessions.length > 0 && (
              <SidebarGroup className="pb-0">
                <SidebarGroupLabel>Pinned</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {pinnedSessions.map((session) => (
                      <SessionSidebarRow
                        key={session.id}
                        active={activeSession?.session.id === session.id}
                        session={session}
                        onSelect={openSession}
                        onSetPinned={(sessionId, pinned) =>
                          void setSessionPinned(sessionId, pinned)
                        }
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            <SidebarGroup>
              <SidebarGroupLabel>Projects</SidebarGroupLabel>
              <SidebarGroupAction
                type="button"
                aria-label="Create project"
                title="Create project"
                disabled={projectsLoading}
                onClick={openCreateProjectDialog}
              >
                <Plus aria-hidden />
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

                      return (
                        <SidebarMenuItem key={project.id}>
                          <div className="group/project relative">
                            <SidebarMenuButton
                              type="button"
                              isActive={
                                activeProject?.id === project.id &&
                                !activeSession
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
                                pinned={pinnedProjectIds.has(project.id)}
                                revealAvailable={project.rootPath !== null}
                                onEdit={() => editProject(project.id)}
                                onReveal={() => void revealProject(project.id)}
                                onTogglePin={() =>
                                  toggleProjectPinned(project.id)
                                }
                              />
                              <button
                                type="button"
                                aria-label={`Edit ${project.name}`}
                                title="Edit"
                                className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[background-color,color,opacity] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-sidebar-ring group-hover/project:opacity-100 group-focus-within/project:opacity-100"
                                onClick={() => editProject(project.id)}
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
                            {visibleSessions.map((session) => (
                              <SessionSidebarRow
                                key={session.id}
                                active={
                                  activeSession?.session.id === session.id
                                }
                                indented
                                session={session}
                                onSelect={openSession}
                                onSetPinned={(sessionId, pinned) =>
                                  void setSessionPinned(sessionId, pinned)
                                }
                              />
                            ))}
                          </SidebarMenu>
                          {unpinnedSessions.length > 5 && (
                            <button
                              type="button"
                              className="ml-7 flex h-7 w-[calc(100%-1.75rem)] items-center rounded-md px-2 text-left text-sm text-muted-foreground outline-none hover:bg-sidebar-accent/55 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                              onClick={() =>
                                setExpandedProjectIds((current) => {
                                  const next = new Set(current);
                                  if (next.has(project.id))
                                    next.delete(project.id);
                                  else next.add(project.id);
                                  return next;
                                })
                              }
                            >
                              {expanded ? "Show less" : "Show more"}
                            </button>
                          )}
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                ) : null}
                {projectError && projects.length > 0 && (
                  <p className="px-2 pt-2 text-xs leading-relaxed text-negative">
                    {projectError}
                  </p>
                )}
              </SidebarGroupContent>
            </SidebarGroup>

            {recentSessions.length > 0 && (
              <SidebarGroup className="pt-0">
                <SidebarGroupLabel>Recents</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visibleRecents.map((session) => (
                      <SessionSidebarRow
                        key={session.id}
                        active={activeSession?.session.id === session.id}
                        session={session}
                        onSelect={openSession}
                        onSetPinned={(sessionId, pinned) =>
                          void setSessionPinned(sessionId, pinned)
                        }
                      />
                    ))}
                  </SidebarMenu>
                  {recentSessions.length > 5 && (
                    <button
                      type="button"
                      className="mt-1 flex h-7 w-full items-center rounded-md px-2 text-left text-sm text-muted-foreground outline-none hover:bg-sidebar-accent/55 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                      onClick={() => setRecentsExpanded((current) => !current)}
                    >
                      {showAllRecents ? "Show less" : "Show more"}
                    </button>
                  )}
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </div>
        </SidebarContent>

        <SidebarFooter className="p-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full"
            onClick={() => navigate("agents")}
          >
            Connect your AI
          </Button>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                tooltip="Account settings"
                className="h-10"
                onClick={() => navigate("settings")}
              >
                <UserAvatar size={16} />
                <span className="min-w-0 flex-1 truncate font-medium">
                  Local workspace
                </span>
                <span className="sr-only">Open account settings</span>
              </SidebarMenuButton>
              <DesktopUpdateAction />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        {!desktopCollapsed && !isMobile && (
          <WorkspaceSidebarResizeEdge
            width={width}
            onWidthChange={onWidthChange}
            onWidthCommit={onWidthCommit}
          />
        )}
      </div>
    </Sidebar>
  );
}
