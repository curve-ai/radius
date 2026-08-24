import { Download, Loader2, RefreshCw } from "lucide-react";
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
      className="right-2 top-3 size-4! rounded-full bg-brand text-brand-foreground hover:bg-brand/90 hover:text-brand-foreground focus-visible:ring-brand/40 disabled:cursor-wait disabled:opacity-80 md:after:block [&>svg]:size-2.5!"
      onClick={() => void performUpdate()}
    >
      {status.state === "downloading" ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : status.state === "downloaded" ? (
        <RefreshCw aria-hidden />
      ) : (
        <Download aria-hidden />
      )}
    </SidebarMenuAction>
  );
}
