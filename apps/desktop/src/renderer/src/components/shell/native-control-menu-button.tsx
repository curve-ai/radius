import { Ellipsis } from "lucide-react";
import { type MouseEvent, type ReactNode } from "react";

import { cn } from "@renderer/lib/utils";
import type { NativeControlMenuPoint } from "../../../../radius-api";

export function NativeControlMenuButton({
  ariaLabel,
  className,
  onOpen,
  open,
}: {
  ariaLabel: string;
  className?: string;
  onOpen: (point: NativeControlMenuPoint) => void;
  open: boolean;
}): ReactNode {
  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();
    onOpen({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    });
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-haspopup="menu"
      aria-expanded={open}
      title="More actions"
      data-state={open ? "open" : "closed"}
      className={cn(
        "flex size-5 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[background-color,color,opacity] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-sidebar-ring group-hover/control-box-target:opacity-100 group-focus-within/control-box-target:opacity-100 data-[state=open]:opacity-100",
        className,
      )}
      onClick={handleClick}
    >
      <Ellipsis className="size-3" strokeWidth={1.75} aria-hidden />
    </button>
  );
}
