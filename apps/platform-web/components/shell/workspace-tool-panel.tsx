"use client";

import { Boxes, List, PackageCheck, Server } from "lucide-react";
import { useEffect, useState } from "react";

import type { PlatformInfoResponse } from "@curve-ai/platform-client";
import {
  ActionToolPanelContent,
  ActionToolPanelGroup,
  ActionToolPanelGroupLabel,
  ActionToolPanelItem,
  ActionToolPanelItemContent,
  ActionToolPanelItemIcon,
  ActionToolPanelItemLabel,
  ActionToolPanelItemMeta,
  ActionToolPanelShell,
  actionToolPanelShouldAnimate,
} from "@/components/ui/action-tool-panel";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/components/ui/motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ShortcutTooltip } from "@/components/ui/shortcut-tooltip";
import { cn } from "@/lib/utils";
import { isToolPanelToggleShortcut } from "@/utils/research-shell-shortcuts";

const PANEL_ID = "platform-tool-panel";
const LAYOUT_ID = "platform-tool-panel-surface";

function ToolPanelContents({ info }: { info: PlatformInfoResponse }) {
  const rows = [
    { label: "Platform version", value: info.platformVersion, icon: Server },
    {
      label: "Deployment mode",
      value: info.deploymentModes.join(", "),
      icon: Boxes,
    },
    {
      label: "Registry upload",
      value: info.registryUpload ? "Available" : "Unavailable",
      icon: PackageCheck,
    },
  ];

  return (
    <ActionToolPanelContent>
      <ActionToolPanelGroup>
        <ActionToolPanelGroupLabel>Platform</ActionToolPanelGroupLabel>
        {rows.map((row) => (
          <ActionToolPanelItem key={row.label}>
            <ActionToolPanelItemIcon>
              <row.icon aria-hidden />
            </ActionToolPanelItemIcon>
            <ActionToolPanelItemContent>
              <ActionToolPanelItemLabel>{row.label}</ActionToolPanelItemLabel>
            </ActionToolPanelItemContent>
            <ActionToolPanelItemMeta>{row.value}</ActionToolPanelItemMeta>
          </ActionToolPanelItem>
        ))}
      </ActionToolPanelGroup>
    </ActionToolPanelContent>
  );
}

export function WorkspaceToolPanel({ info }: { info: PlatformInfoResponse }) {
  return (
    <ActionToolPanelShell
      id={PANEL_ID}
      aria-label="Platform details"
      surface="desktop"
      sharedLayoutId={LAYOUT_ID}
    >
      <ToolPanelContents info={info} />
    </ActionToolPanelShell>
  );
}

export function WorkspaceToolPanelTrigger({
  info,
  desktopOpen,
  desktopVisible,
  onDesktopOpenChange,
}: {
  info: PlatformInfoResponse;
  desktopOpen: boolean;
  desktopVisible: boolean;
  onDesktopOpenChange: (open: boolean) => void;
}) {
  const [compactOpen, setCompactOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isToolPanelToggleShortcut(event)) return;
      event.preventDefault();
      if (desktopVisible) onDesktopOpenChange(!desktopOpen);
      else setCompactOpen((open) => !open);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [desktopOpen, desktopVisible, onDesktopOpenChange]);

  useEffect(() => {
    if (desktopVisible) setCompactOpen(false);
  }, [desktopVisible]);

  const activeOpen = desktopVisible ? desktopOpen : compactOpen;

  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-controls={PANEL_ID}
      aria-expanded={activeOpen}
      aria-keyshortcuts="Meta+/ Control+/"
      aria-label={activeOpen ? "Hide platform details" : "Show platform details"}
      className={cn("size-9 rounded-lg", activeOpen && "bg-accent")}
      onClick={() =>
        desktopVisible
          ? onDesktopOpenChange(!desktopOpen)
          : setCompactOpen((open) => !open)
      }
    >
      <List aria-hidden />
    </Button>
  );

  return (
    <Popover open={!desktopVisible && compactOpen} onOpenChange={setCompactOpen}>
      <PopoverTrigger asChild>
        {desktopVisible ? (
          <ShortcutTooltip label="Platform details" shortcut="⌘/" side="bottom">
            {button}
          </ShortcutTooltip>
        ) : (
          button
        )}
      </PopoverTrigger>
      {!desktopVisible && (
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-auto border-0 bg-transparent p-0 shadow-none"
          style={
            actionToolPanelShouldAnimate(reduceMotion, "animate")
              ? undefined
              : { animationDuration: "0ms" }
          }
        >
          <ActionToolPanelShell
            surface="popover"
            aria-label="Platform details"
            sharedLayoutId={LAYOUT_ID}
          >
            <ToolPanelContents info={info} />
          </ActionToolPanelShell>
        </PopoverContent>
      )}
    </Popover>
  );
}
