"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  PlatformIdentityResponse,
  PlatformInfoResponse,
} from "@curve-ai/platform-client";
import {
  actionToolPanelDesktopFits,
  actionToolPanelShouldAnimate,
} from "@/components/ui/action-tool-panel";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from "@/components/ui/motion";
import { SidebarProvider } from "@/components/ui/sidebar";
import { WorkspaceHeader } from "./workspace-header";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { WorkspaceToolPanel } from "./workspace-tool-panel";
import type { PlatformWebAuthMode } from "@/lib/platform-auth";

const SKIP_LINK_CLASS =
  "sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-md focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-background";
const TOOL_PANEL_COOKIE_NAME = "radius_platform_tool_panel";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

export function WorkspaceShell({
  children,
  info,
  identity,
  organization,
  authMode,
}: {
  children: ReactNode;
  info: PlatformInfoResponse;
  identity: PlatformIdentityResponse;
  organization: PlatformIdentityResponse["organizations"][number] | undefined;
  authMode: PlatformWebAuthMode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toolPanelOpen, setToolPanelOpen] = useState(true);
  const [workbenchWidth, setWorkbenchWidth] = useState<number | null>(null);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const desktopToolPanelVisible = actionToolPanelDesktopFits(
    workbenchWidth,
    false,
  );
  const animatePanel = actionToolPanelShouldAnimate(reduceMotion, "animate");

  useLayoutEffect(() => {
    const workbench = workbenchRef.current;
    if (!workbench) return;
    const update = (width: number) => setWorkbenchWidth(Math.round(width));
    update(workbench.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width));
    observer.observe(workbench);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const cookies = document.cookie.split("; ");
    const sidebar = cookies.find((item) => item.startsWith("sidebar_state="));
    const tools = cookies.find((item) =>
      item.startsWith(`${TOOL_PANEL_COOKIE_NAME}=`),
    );
    if (sidebar?.endsWith("=false")) setSidebarOpen(false);
    if (tools?.endsWith("=false")) setToolPanelOpen(false);
  }, []);

  const setTools = useCallback((open: boolean) => {
    setToolPanelOpen(open);
    document.cookie = `${TOOL_PANEL_COOKIE_NAME}=${open}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  }, []);

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      className="min-h-dvh bg-background"
    >
      <a href="#main-content" className={SKIP_LINK_CLASS}>
        Skip to content
      </a>
      <WorkspaceSidebar
        identity={identity}
        organization={organization}
        authMode={authMode}
      />
      <div
        id="main-content"
        className="relative flex min-h-dvh min-w-0 flex-1 flex-col overflow-x-clip bg-background"
      >
        <LayoutGroup id="platform-tool-panel-layout">
          <WorkspaceHeader
            info={info}
            toolPanelOpen={toolPanelOpen}
            desktopToolPanelVisible={desktopToolPanelVisible}
            onToolPanelOpenChange={setTools}
          />
          <div
            ref={workbenchRef}
            className="@container/workspace-workbench flex min-h-0 min-w-0 flex-1"
          >
            <div className="min-w-0 flex-1">{children}</div>
            <AnimatePresence initial={false} mode="popLayout">
              {toolPanelOpen && desktopToolPanelVisible && (
                <motion.div
                  key="platform-tool-panel"
                  initial={animatePanel ? { opacity: 0, x: 8 } : { opacity: 0 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={animatePanel ? { opacity: 0, x: 8 } : { opacity: 0 }}
                  transition={{
                    duration: reduceMotion ? 0.08 : 0.16,
                    ease: [0.23, 1, 0.32, 1],
                  }}
                  className="shrink-0"
                >
                  <WorkspaceToolPanel info={info} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </LayoutGroup>
      </div>
    </SidebarProvider>
  );
}
