import { useEffect, useRef, useState, type ReactNode } from "react";

import { useWorkspaceNavigation } from "@renderer/components/shell/navigation-context";
import { WORKSPACE_TITLES } from "@renderer/components/shell/types";
import { useSidebar } from "@renderer/components/ui/sidebar";
import { cn } from "@renderer/lib/utils";
import { WorkspaceToolPanelTrigger } from "./workspace-tool-panel";

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

  return (
    <>
      <div
        ref={topSentinelRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 size-px"
      />
      <header
        data-scrolled={scrolled ? "true" : "false"}
        className={cn(
          "sticky top-0 z-40 flex h-12 shrink-0 items-center border-b border-transparent bg-background px-3 data-[scrolled=true]:border-border sm:px-4",
          titlebarControlsOverlapHeader &&
            "radius-workspace-header-content-offset",
        )}
      >
        <div
          aria-hidden="true"
          className={cn(
            "electron-window-drag pointer-events-none absolute inset-y-0 left-0 right-0",
            titlebarControlsOverlapHeader &&
              "radius-workspace-header-drag-offset",
            !minimal && toolPanelAvailable && "right-12",
          )}
        />
        {minimal ? (
          <span className="sr-only">
            {title ?? WORKSPACE_TITLES[activeView]}
          </span>
        ) : (
          <>
            <span
              aria-hidden={collapsingTitle ? "true" : undefined}
              className={cn(
                "min-w-0 flex-1 truncate type-base text-foreground",
                collapsingTitle && "radius-collapsing-header-title",
              )}
            >
              {title ?? WORKSPACE_TITLES[activeView]}
            </span>
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
