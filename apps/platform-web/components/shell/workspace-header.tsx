"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import type { PlatformInfoResponse } from "@curve-ai/platform-client";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { WorkspaceToolPanelTrigger } from "./workspace-tool-panel";

const TITLES: Record<string, string> = {
  "/workspace": "Overview",
  "/workspace/agents": "Agents",
  "/workspace/devices": "Devices",
  "/workspace/settings": "Settings",
};

export function WorkspaceHeader({
  info,
  toolPanelOpen,
  desktopToolPanelVisible,
  onToolPanelOpenChange,
}: {
  info: PlatformInfoResponse;
  toolPanelOpen: boolean;
  desktopToolPanelVisible: boolean;
  onToolPanelOpenChange: (open: boolean) => void;
}) {
  const pathname = usePathname() ?? "/workspace";
  const title =
    TITLES[pathname] ??
    (pathname.startsWith("/workspace/agents/") ? "Agent" : "Radius Platform");
  const [scrolled, setScrolled] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sentinel.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 1 },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div
        ref={sentinel}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 size-px"
      />
      <header
        data-scrolled={scrolled ? "true" : "false"}
        className="sticky top-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center border-b border-transparent bg-background px-3 pt-[env(safe-area-inset-top)] data-[scrolled=true]:border-border sm:px-4"
      >
        <SidebarTrigger className="mr-2 size-9 md:hidden" />
        <h1 className="min-w-0 flex-1 truncate type-md font-normal text-foreground">
          {title}
        </h1>
        <WorkspaceToolPanelTrigger
          info={info}
          desktopOpen={toolPanelOpen}
          desktopVisible={desktopToolPanelVisible}
          onDesktopOpenChange={onToolPanelOpenChange}
        />
      </header>
    </>
  );
}
