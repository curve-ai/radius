import { Download, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { SidebarMenuAction } from "@renderer/components/ui/sidebar";
import { useDesktopUpdate } from "./use-desktop-update";

export function DesktopUpdateAction(): ReactNode {
  const { status, performUpdate } = useDesktopUpdate();
  const visible =
    status?.state === "available" ||
    status?.state === "downloading" ||
    status?.state === "downloaded";

  if (!visible) return null;

  const label =
    status.state === "downloaded"
      ? `Restart to install Radius ${status.availableVersion ?? "update"}`
      : status.state === "downloading"
        ? `Downloading Radius ${status.availableVersion ?? "update"}: ${status.percent ?? 0}%`
        : `Download Radius ${status.availableVersion ?? "update"}`;

  return (
    <SidebarMenuAction
      type="button"
      aria-label={label}
      title={label}
      disabled={status.state === "downloading"}
      className={
        status.state === "downloading"
          ? "right-2 top-2 h-6! min-w-14 rounded-full bg-brand px-3 text-sm font-medium tabular-nums text-brand-foreground hover:bg-brand/90 hover:text-brand-foreground focus-visible:ring-brand/40 disabled:cursor-wait disabled:opacity-80 md:after:block"
          : status.state === "downloaded"
            ? "right-1 top-1 size-8! rounded-xl bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring md:after:block [&>svg]:size-4!"
            : "right-2 top-3 size-4! rounded-full bg-brand text-brand-foreground hover:bg-brand/90 hover:text-brand-foreground focus-visible:ring-brand/40 md:after:block [&>svg]:size-2.5!"
      }
      onClick={() => void performUpdate()}
    >
      {status.state === "downloading" ? (
        `${status.percent ?? 0}%`
      ) : status.state === "downloaded" ? (
        <RefreshCw aria-hidden />
      ) : (
        <Download aria-hidden />
      )}
    </SidebarMenuAction>
  );
}
