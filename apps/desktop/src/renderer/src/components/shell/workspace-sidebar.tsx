import { Clock3, Plug, Search, SquarePen } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { useWorkspaceNavigation } from "@renderer/components/shell/navigation-context";
import { UserAvatar } from "@renderer/components/shell/user-avatar";
import { Button } from "@renderer/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@renderer/components/ui/sidebar";
import { Wordmark } from "@renderer/components/ui/wordmark";
import { cn } from "@renderer/lib/utils";
import { DesktopUpdateAction } from "./desktop-update-action";
import { useStartNewChat } from "./use-start-new-chat";
import { WorkspaceSessionList } from "./workspace-session-list";
import {
  clampWorkspaceSidebarWidth,
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
    view: "connectors",
    label: "Connectors",
    icon: Plug,
    showsActiveState: true,
  },
] as const;

type SidebarResizeState = {
  pointerId: number;
  startX: number;
  startWidth: number;
  latestWidth: number;
  previousCursor: string;
  previousResizing: string | undefined;
  previousUserSelect: string;
};

function WorkspaceSidebarResizeEdge({
  width,
  maxWidth,
  onWidthChange,
  onWidthCommit,
}: {
  width: number;
  maxWidth: number;
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
      maxWidth,
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
    if (event.key === "End") nextWidth = maxWidth;
    if (nextWidth === null) return;

    event.preventDefault();
    const clampedWidth = clampWorkspaceSidebarWidth(nextWidth, maxWidth);
    onWidthChange(clampedWidth);
    onWidthCommit(clampedWidth);
  };

  return (
    <div
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemin={WORKSPACE_SIDEBAR_MIN_WIDTH}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      tabIndex={0}
      className="electron-window-no-drag absolute inset-y-0 -right-1 z-30 block w-2 cursor-col-resize touch-none outline-none focus-visible:bg-sidebar-ring/40"
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
  maxWidth,
  onWidthChange,
  onWidthCommit,
  onSearch,
}: {
  width: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
  onSearch: () => void;
}): ReactNode {
  const { activeView, navigate } = useWorkspaceNavigation();
  const startNewChat = useStartNewChat();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <>
      <div
        data-slot="sidebar-gap"
        aria-hidden="true"
        className={cn(
          "relative shrink-0 bg-transparent transition-[width] duration-200 ease-linear",
          collapsed ? "w-0" : "w-(--sidebar-width)",
        )}
      />
      <Sidebar
        collapsible="none"
        data-slot="sidebar-container"
        data-state={state}
        aria-hidden={collapsed || undefined}
        inert={collapsed || undefined}
        className={cn(
          "fixed inset-y-0 z-50 h-dvh bg-transparent! transition-[left,width] duration-200 ease-linear",
          collapsed
            ? "pointer-events-none left-[calc(var(--sidebar-width)*-1)]"
            : "left-0",
        )}
      >
        <div className="electron-window-drag absolute inset-x-0 top-0 h-10" />
        <div className="radius-sidebar-material relative flex h-full w-full flex-col">
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

            <WorkspaceSessionList />
          </SidebarContent>

          <SidebarFooter className="p-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={() => navigate("agents")}
            >
              Agents
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
                  <span className="min-w-0 flex-1 truncate">
                    Local workspace
                  </span>
                  <span className="sr-only">Open account settings</span>
                </SidebarMenuButton>
                <DesktopUpdateAction />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>

          {!collapsed && (
            <WorkspaceSidebarResizeEdge
              width={width}
              maxWidth={maxWidth}
              onWidthChange={onWidthChange}
              onWidthCommit={onWidthCommit}
            />
          )}
        </div>
      </Sidebar>
    </>
  );
}
