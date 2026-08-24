import { ArrowLeft, ArrowRight, PanelLeftIcon, SquarePen } from "lucide-react";
import type { ReactNode } from "react";

import { useWorkspaceNavigation } from "@renderer/components/shell/navigation-context";
import { Button } from "@renderer/components/ui/button";
import { useSidebar } from "@renderer/components/ui/sidebar";
import { useStartNewChat } from "./use-start-new-chat";

const titlebarControlClass =
  "size-7 shrink-0 rounded-md p-0 text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground focus-visible:bg-foreground/[0.08] focus-visible:ring-0 active:scale-100 disabled:opacity-30 [&>svg]:block [&>svg]:size-3.5 [&>svg]:shrink-0";

export function WorkspaceHistoryControls(): ReactNode {
  const { activeView, canGoBack, canGoForward, goBack, goForward } =
    useWorkspaceNavigation();
  const { isMobile, openMobile, state, toggleSidebar } = useSidebar();
  const startNewChat = useStartNewChat();
  const sidebarOpen = isMobile ? openMobile : state === "expanded";
  const sidebarLabel = sidebarOpen ? "Collapse sidebar" : "Expand sidebar";

  return (
    <div className="radius-window-navigation electron-window-no-drag pointer-events-auto fixed top-0 z-[70] flex h-7 items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={titlebarControlClass}
        aria-label={sidebarLabel}
        aria-keyshortcuts="Meta+B Control+B"
        title={sidebarLabel}
        onClick={toggleSidebar}
      >
        <PanelLeftIcon strokeWidth={1.75} aria-hidden />
      </Button>
      <nav aria-label="History" className="flex h-7 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={titlebarControlClass}
          aria-label="Back"
          title="Back"
          disabled={!canGoBack}
          onClick={goBack}
        >
          <ArrowLeft strokeWidth={1.75} aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={titlebarControlClass}
          aria-label="Forward"
          title="Forward"
          disabled={!canGoForward}
          onClick={goForward}
        >
          <ArrowRight strokeWidth={1.75} aria-hidden />
        </Button>
      </nav>
      {!sidebarOpen && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={titlebarControlClass}
            aria-label="New chat"
            title="New chat"
            onClick={startNewChat}
          >
            <SquarePen strokeWidth={1.75} aria-hidden />
          </Button>
          {activeView !== "workspace" && (
            <div aria-hidden="true" className="ml-2 h-6 w-px bg-border" />
          )}
        </>
      )}
    </div>
  );
}
