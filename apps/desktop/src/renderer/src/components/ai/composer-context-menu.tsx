import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ReactElement, ReactNode } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover";
import { cn } from "@renderer/lib/utils";

export function ComposerContextMenu({
  children,
  className,
  onOpenChange,
  open,
  trigger,
}: {
  children: ReactNode;
  className?: string;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  trigger: ReactElement;
}): ReactNode {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={4}
        collisionPadding={8}
        aria-label="Composer context"
        className={cn(
          "max-h-[min(24rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] overflow-y-auto overscroll-contain rounded-[1rem] border border-border bg-background p-1 shadow-md",
          className,
        )}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function ComposerContextMenuClose({
  children,
}: {
  children: ReactElement;
}): ReactNode {
  return <PopoverPrimitive.Close asChild>{children}</PopoverPrimitive.Close>;
}
