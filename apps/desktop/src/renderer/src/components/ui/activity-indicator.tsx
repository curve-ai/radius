import * as React from "react";

import { cn } from "@renderer/lib/utils";

const ACTIVITY_PIXEL_DELAYS = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  const column = index % 3;
  return (column + Math.abs(row - 1)) * 90;
});

export function ActivityIndicator({
  active = true,
  className,
  label,
}: {
  active?: boolean;
  className?: string;
  label?: string;
}): React.ReactNode {
  return (
    <span
      data-slot="activity-indicator"
      data-active={active}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px] text-foreground",
        className,
      )}
    >
      {ACTIVITY_PIXEL_DELAYS.map((delay, index) => (
        <span
          key={index}
          className="radius-thinking-pixel size-1 rounded-[1px] bg-current"
          style={{ "--thinking-delay": `${delay}ms` } as React.CSSProperties}
        />
      ))}
    </span>
  );
}
