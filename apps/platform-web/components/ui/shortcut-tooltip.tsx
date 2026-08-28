"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ShortcutTooltipProps extends Omit<
  React.ComponentProps<typeof TooltipContent>,
  "children" | "className"
> {
  children: React.ReactElement;
  className?: string;
  label: string;
  shortcut: string;
}

export function ShortcutTooltip({
  children,
  className,
  label,
  shortcut,
  sideOffset = 8,
  ...contentProps
}: ShortcutTooltipProps) {
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        sideOffset={sideOffset}
        className={cn(
          "pointer-events-none flex items-center gap-1.5 px-2 py-1",
          className,
        )}
        {...contentProps}
      >
        <span>{label}</span>
        <kbd className="rounded border border-border bg-background px-1 py-0 font-mono text-[0.6875rem] leading-4 text-muted-foreground">
          {shortcut}
        </kbd>
      </TooltipContent>
    </Tooltip>
  );
}
