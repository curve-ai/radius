import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

import { useWorkspaceNavigation } from "@renderer/components/shell/navigation-context";
import { useProjects } from "@renderer/components/shell/project-context-value";
import { WORKSPACE_TITLES } from "@renderer/components/shell/types";
import { useSidebar } from "@renderer/components/ui/sidebar";
import { cn } from "@renderer/lib/utils";
import { WorkspaceSessionHeader } from "./workspace-session-header";
import { WorkspaceToolPanelTrigger } from "./workspace-tool-panel";

const WINDOW_CONTROL_SELECTOR = [
  ".electron-window-no-drag",
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "label",
  '[role="button"]',
  '[contenteditable="true"]',
].join(",");

export function WorkspaceHeader({
  collapsingTitle = false,
  minimal = false,
  title,
  toolPanelAvailable = true,
  toolPanelOpen,
  desktopToolPanelVisible,
  onToolPanelOpenChange,
}: {
  collapsingTitle?: boolean;
  minimal?: boolean;
  title?: string;
  toolPanelAvailable?: boolean;
  toolPanelOpen: boolean;
  desktopToolPanelVisible: boolean;
  onToolPanelOpenChange: (open: boolean) => void;
}): ReactNode {
  const { activeView } = useWorkspaceNavigation();
  const { activeSession } = useProjects();
  const { isMobile, state: sidebarState } = useSidebar();
  const [scrolled, setScrolled] = useState(false);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const titlebarControlsOverlapHeader =
    isMobile || sidebarState === "collapsed";

  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 1 },
    );
    observer.observe(sentinel);

    return () => observer.disconnect();
  }, []);

  const handleDoubleClick = (event: MouseEvent<HTMLElement>): void => {
    if (event.button !== 0 || window.radius.platform !== "darwin") return;
    if (
      event.target instanceof Element &&
      event.target.closest(WINDOW_CONTROL_SELECTOR)
    ) {
      return;
    }

    void window.radius.handleTitlebarDoubleClick();
  };

  return (
    <>
      <div
        ref={topSentinelRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 size-px"
      />
      <header
        data-scrolled={scrolled ? "true" : "false"}
        onDoubleClick={handleDoubleClick}
        className={cn(
          "electron-window-drag sticky top-0 z-40 flex h-12 shrink-0 items-center border-b bg-background px-3 sm:px-4",
          minimal
            ? "border-transparent data-[scrolled=true]:border-border"
            : "border-border",
          titlebarControlsOverlapHeader &&
            "radius-workspace-header-content-offset",
        )}
      >
        {minimal ? (
          <span className="sr-only">
            {title ?? WORKSPACE_TITLES[activeView]}
          </span>
        ) : (
          <>
            {activeView === "workspace" && activeSession ? (
              <WorkspaceSessionHeader key={activeSession.session.id} />
            ) : (
              <span
                aria-hidden={collapsingTitle ? "true" : undefined}
                className={cn(
                  "min-w-0 flex-1 truncate type-base text-foreground",
                  collapsingTitle && "radius-collapsing-header-title",
                )}
              >
                {title ?? WORKSPACE_TITLES[activeView]}
              </span>
            )}
            {toolPanelAvailable ? (
              <div className="electron-window-no-drag ml-2 shrink-0">
                <WorkspaceToolPanelTrigger
                  desktopOpen={toolPanelOpen}
                  desktopVisible={desktopToolPanelVisible}
                  onDesktopOpenChange={onToolPanelOpenChange}
                />
              </div>
            ) : null}
          </>
        )}
      </header>
    </>
  );
}
