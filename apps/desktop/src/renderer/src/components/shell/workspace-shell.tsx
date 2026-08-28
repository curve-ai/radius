import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  actionToolPanelDesktopFits,
  actionToolPanelShouldAnimate,
} from "@renderer/components/ui/action-tool-panel";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from "@renderer/components/ui/motion";
import { SidebarProvider } from "@renderer/components/ui/sidebar";
import { cn } from "@renderer/lib/utils";
import { useWorkspaceNavigation } from "./navigation-context";
import { useProjects } from "./project-context-value";
import { WORKSPACE_TITLES } from "./types";
import { WorkspaceHeader } from "./workspace-header";
import { WorkspaceHistoryControls } from "./workspace-history-controls";
import { WorkspaceSearchDialog } from "./workspace-search-dialog";
import { WorkspaceSidebar } from "./workspace-sidebar";
import {
  clampWorkspaceSidebarWidth,
  getWorkspaceSidebarMaxWidth,
  WORKSPACE_SIDEBAR_DEFAULT_WIDTH,
} from "./workspace-sidebar-width";
import { WorkspaceToolPanel } from "./workspace-tool-panel";

const TOOL_PANEL_STORAGE_KEY = "radius:workspace-tool-panel";
const SIDEBAR_WIDTH_STORAGE_KEY = "radius:workspace-sidebar-width";

function getInitialSidebarWidth(): number {
  const storedWidth = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));

  return Number.isFinite(storedWidth) && storedWidth > 0
    ? clampWorkspaceSidebarWidth(storedWidth)
    : WORKSPACE_SIDEBAR_DEFAULT_WIDTH;
}

export function WorkspaceShell({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const { activeView } = useWorkspaceNavigation();
  const { activeSession } = useProjects();
  const isNewChat = activeView === "workspace" && activeSession === null;
  const hasCollapsingTitle = activeView === "connectors";
  const toolPanelAvailable = !isNewChat && activeView !== "connectors";
  const headerTitle =
    activeView === "workspace" && activeSession
      ? activeSession.session.title
      : WORKSPACE_TITLES[activeView];
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem("sidebar_state") !== "false",
  );
  const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toolPanelOpen, setToolPanelOpen] = useState(
    () => localStorage.getItem(TOOL_PANEL_STORAGE_KEY) !== "false",
  );
  const [workbenchWidth, setWorkbenchWidth] = useState<number | null>(null);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const desktopToolPanelVisible = actionToolPanelDesktopFits(
    workbenchWidth,
    false,
  );
  const animateToolPanelGeometry = actionToolPanelShouldAnimate(
    reduceMotion,
    "animate",
  );
  const sidebarMaxWidth = getWorkspaceSidebarMaxWidth(viewportWidth);
  const effectiveSidebarWidth = clampWorkspaceSidebarWidth(
    sidebarWidth,
    sidebarMaxWidth,
  );

  useEffect(() => {
    document.title = `${headerTitle} · Radius`;
  }, [headerTitle]);

  useLayoutEffect(() => {
    const updateViewportWidth = (): void => {
      setViewportWidth(Math.round(window.innerWidth));
    };
    window.addEventListener("resize", updateViewportWidth);
    updateViewportWidth();

    return () => window.removeEventListener("resize", updateViewportWidth);
  }, []);

  useLayoutEffect(() => {
    const workbench = workbenchRef.current;
    if (!workbench) return;

    const updateWidth = (width: number): void => {
      setWorkbenchWidth(Math.round(width));
    };
    updateWidth(workbench.getBoundingClientRect().width);

    const observer = new ResizeObserver(([entry]) => {
      updateWidth(entry.contentRect.width);
    });
    observer.observe(workbench);

    return () => observer.disconnect();
  }, []);

  const handleSidebarOpenChange = useCallback((open: boolean) => {
    setSidebarOpen(open);
    localStorage.setItem("sidebar_state", String(open));
  }, []);

  const handleSidebarWidthCommit = useCallback((width: number) => {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
  }, []);

  const handleToolPanelOpenChange = useCallback((open: boolean) => {
    setToolPanelOpen(open);
    localStorage.setItem(TOOL_PANEL_STORAGE_KEY, String(open));
  }, []);

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={handleSidebarOpenChange}
      className="h-full min-h-0 overflow-hidden bg-transparent"
      style={
        {
          "--sidebar-width": `${effectiveSidebarWidth}px`,
        } as CSSProperties
      }
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-md focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-background"
      >
        Skip to content
      </a>
      <WorkspaceSidebar
        width={effectiveSidebarWidth}
        maxWidth={sidebarMaxWidth}
        onWidthChange={setSidebarWidth}
        onWidthCommit={handleSidebarWidthCommit}
        onSearch={() => setSearchOpen(true)}
      />
      <WorkspaceSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <WorkspaceHistoryControls />
      <div className="radius-workspace-timeline-scope relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <LayoutGroup id="workspace-tool-panel-layout">
          <WorkspaceHeader
            collapsingTitle={hasCollapsingTitle}
            minimal={isNewChat}
            title={headerTitle}
            toolPanelAvailable={toolPanelAvailable}
            toolPanelOpen={toolPanelOpen}
            desktopToolPanelVisible={desktopToolPanelVisible}
            onToolPanelOpenChange={handleToolPanelOpenChange}
          />

          <div
            ref={workbenchRef}
            className="@container/workspace-workbench flex min-h-0 min-w-0 flex-1 overflow-hidden"
          >
            <main
              id="main-content"
              className={cn(
                "h-full min-h-0 min-w-0 flex-1 outline-none focus:outline-none focus-visible:outline-none",
                activeView === "workspace"
                  ? "overflow-hidden"
                  : "overflow-x-hidden overflow-y-auto overscroll-contain",
                hasCollapsingTitle && "radius-workspace-scroll-timeline",
              )}
              tabIndex={-1}
            >
              {children}
            </main>
            <AnimatePresence initial={false} mode="popLayout">
              {toolPanelAvailable &&
                toolPanelOpen &&
                desktopToolPanelVisible && (
                  <motion.div
                    key="workspace-tool-panel-rail"
                    initial={
                      animateToolPanelGeometry
                        ? { opacity: 0, x: 8 }
                        : { opacity: 0 }
                    }
                    animate={{ opacity: 1, x: 0 }}
                    exit={
                      animateToolPanelGeometry
                        ? { opacity: 0, x: 8 }
                        : { opacity: 0 }
                    }
                    transition={{
                      duration: reduceMotion ? 0.08 : 0.16,
                      ease: [0.23, 1, 0.32, 1],
                    }}
                    className="shrink-0"
                  >
                    <WorkspaceToolPanel />
                  </motion.div>
                )}
            </AnimatePresence>
          </div>
        </LayoutGroup>
      </div>
    </SidebarProvider>
  );
}
