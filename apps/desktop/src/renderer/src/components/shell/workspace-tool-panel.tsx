import { useEffect, useState, type ReactNode } from "react";
import { Database, HardDrive, List } from "lucide-react";

import { useWorkspaceNavigation } from "@renderer/components/shell/navigation-context";
import type { WorkspaceView } from "@renderer/components/shell/types";
import {
  ActionToolPanelButton,
  ActionToolPanelContent,
  ActionToolPanelGroup,
  ActionToolPanelGroupLabel,
  ActionToolPanelItemContent,
  ActionToolPanelItemIcon,
  ActionToolPanelItemLabel,
  ActionToolPanelItemMeta,
  ActionToolPanelShell,
  actionToolPanelShouldAnimate,
} from "@renderer/components/ui/action-tool-panel";
import { Button } from "@renderer/components/ui/button";
import { useReducedMotion } from "@renderer/components/ui/motion";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover";
import { ShortcutTooltip } from "@renderer/components/ui/shortcut-tooltip";
import { cn } from "@renderer/lib/utils";
import { isToolPanelToggleShortcut } from "@renderer/utils/research-shell-shortcuts";

const WORKSPACE_TOOL_PANEL_ID = "workspace-tool-panel";
const WORKSPACE_TOOL_PANEL_LAYOUT_ID = "workspace-tool-panel-surface";

function WorkspaceToolPanelContents({
  activeView,
  onNavigate,
  onCompactNavigate,
}: {
  activeView: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  onCompactNavigate?: () => void;
}): ReactNode {
  const checks = [
    {
      label: "Runtime",
      value: "Local",
      icon: HardDrive,
      view: "activity",
    },
    {
      label: "Storage",
      value: "Ready",
      icon: Database,
      view: "artifacts",
    },
  ] satisfies Array<{
    label: string;
    value: string;
    icon: typeof HardDrive;
    view: WorkspaceView;
  }>;

  return (
    <ActionToolPanelContent>
      <ActionToolPanelGroup>
        <ActionToolPanelGroupLabel>Environment</ActionToolPanelGroupLabel>
        {checks.map((item) => (
          <ActionToolPanelButton
            key={item.label}
            type="button"
            selected={activeView === item.view}
            onClick={() => {
              onNavigate(item.view);
              onCompactNavigate?.();
            }}
          >
            <ActionToolPanelItemIcon>
              <item.icon aria-hidden />
            </ActionToolPanelItemIcon>
            <ActionToolPanelItemContent>
              <ActionToolPanelItemLabel>{item.label}</ActionToolPanelItemLabel>
            </ActionToolPanelItemContent>
            <ActionToolPanelItemMeta className="text-sm capitalize">
              {item.value}
            </ActionToolPanelItemMeta>
          </ActionToolPanelButton>
        ))}
      </ActionToolPanelGroup>
    </ActionToolPanelContent>
  );
}

export function WorkspaceToolPanel(): ReactNode {
  const { activeView, navigate } = useWorkspaceNavigation();

  return (
    <ActionToolPanelShell
      id={WORKSPACE_TOOL_PANEL_ID}
      aria-label="Workspace tools"
      surface="desktop"
      sharedLayoutId={WORKSPACE_TOOL_PANEL_LAYOUT_ID}
      className="!top-12"
    >
      <WorkspaceToolPanelContents
        activeView={activeView}
        onNavigate={navigate}
      />
    </ActionToolPanelShell>
  );
}

export function WorkspaceToolPanelTrigger({
  desktopOpen,
  desktopVisible,
  onDesktopOpenChange,
}: {
  desktopOpen: boolean;
  desktopVisible: boolean;
  onDesktopOpenChange: (open: boolean) => void;
}): ReactNode {
  const { activeView, navigate } = useWorkspaceNavigation();
  const [compactOpen, setCompactOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const desktopLabel = desktopOpen ? "Hide tools" : "Show tools";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!isToolPanelToggleShortcut(event)) return;

      event.preventDefault();
      if (desktopVisible) {
        onDesktopOpenChange(!desktopOpen);
      } else {
        setCompactOpen((open) => !open);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [desktopOpen, desktopVisible, onDesktopOpenChange]);

  return (
    <>
      {desktopVisible && (
        <ShortcutTooltip
          label={desktopLabel}
          shortcut="⌘/"
          side="bottom"
          align="end"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-controls={WORKSPACE_TOOL_PANEL_ID}
            aria-expanded={desktopOpen}
            aria-keyshortcuts="Meta+/ Control+/"
            aria-label={desktopLabel}
            className={cn(
              "size-7 rounded-md",
              desktopOpen && "bg-accent text-accent-foreground",
            )}
            onClick={() => onDesktopOpenChange(!desktopOpen)}
          >
            <List className="size-4" aria-hidden />
          </Button>
        </ShortcutTooltip>
      )}

      <Popover
        open={!desktopVisible && compactOpen}
        onOpenChange={setCompactOpen}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-keyshortcuts="Meta+/ Control+/"
            aria-label={compactOpen ? "Close tools" : "Open tools"}
            className={cn(
              "size-7 rounded-md data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
              desktopVisible && "hidden",
            )}
          >
            <List className="size-4" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={8}
          collisionPadding={12}
          className="w-auto border-0 bg-transparent p-0 shadow-none"
          style={
            actionToolPanelShouldAnimate(reduceMotion, "animate")
              ? undefined
              : { animationDuration: "0ms" }
          }
        >
          <ActionToolPanelShell
            surface="popover"
            aria-label="Workspace tools"
            sharedLayoutId={WORKSPACE_TOOL_PANEL_LAYOUT_ID}
          >
            <WorkspaceToolPanelContents
              activeView={activeView}
              onNavigate={navigate}
              onCompactNavigate={() => setCompactOpen(false)}
            />
          </ActionToolPanelShell>
        </PopoverContent>
      </Popover>
    </>
  );
}
