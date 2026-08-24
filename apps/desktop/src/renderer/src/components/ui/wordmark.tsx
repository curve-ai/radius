import { cn } from "@renderer/lib/utils";
import type { ReactNode } from "react";

type WordmarkSize = "xs" | "sm" | "md" | "lg";

const SIZES: Record<WordmarkSize, string> = {
  xs: "text-[11px]",
  sm: "text-[13px]",
  md: "text-lg",
  lg: "text-[34px]",
};

export function Wordmark({
  size = "sm",
  label = "Radius",
  className,
}: {
  size?: WordmarkSize;
  label?: string;
  className?: string;
}): ReactNode {
  return (
    <span className={cn("inline-flex h-8 items-center", className)}>
      <span
        className={cn(
          SIZES[size],
          "font-semibold uppercase leading-none tracking-[0.05em]",
        )}
      >
        {label}
      </span>
    </span>
  );
}
