import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useScroll, useTransform } from "motion/react";

import { useWorkspaceNavigation } from "@renderer/components/shell/navigation-context";
import { useProjects } from "@renderer/components/shell/project-context-value";
import { WORKSPACE_TITLES } from "@renderer/components/shell/types";
import { motion, useReducedMotion } from "@renderer/components/ui/motion";
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

function CollapsingHeaderTitle({
  scrollContainerRef,
  title,
}: {
  scrollContainerRef: RefObject<HTMLElement | null>;
  title: string;
}): ReactNode {
  const reduceMotion = useReducedMotion();
  const { scrollY } = useScroll({ container: scrollContainerRef });
  const opacity = useTransform(scrollY, [24, 72], [0, 1]);
  const transform = useTransform(
    scrollY,
    [24, 72],
    ["translate3d(0, 4px, 0)", "translate3d(0, 0, 0)"],
  );

  return (
    <>
      <motion.span
        aria-hidden="true"
        className="min-w-0 flex-1 truncate type-base text-foreground"
        style={{
          opacity,
          transform: reduceMotion ? "none" : transform,
        }}
      >
        {title}
      </motion.span>
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border"
        style={{ opacity }}
      />
    </>
  );
}

export function WorkspaceHeader({
  collapsingTitle = false,
  minimal = false,
  title,
  scrollContainerRef,
  toolPanelAvailable = true,
  toolPanelOpen,
  desktopToolPanelVisible,
  onToolPanelOpenChange,
}: {
  collapsingTitle?: boolean;
  minimal?: boolean;
  title?: string;
  scrollContainerRef: RefObject<HTMLElement | null>;
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
            : collapsingTitle
              ? "border-transparent"
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
            ) : collapsingTitle ? (
              <CollapsingHeaderTitle
                scrollContainerRef={scrollContainerRef}
                title={title ?? WORKSPACE_TITLES[activeView]}
              />
            ) : (
              <span className="min-w-0 flex-1 truncate type-base text-foreground">
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
