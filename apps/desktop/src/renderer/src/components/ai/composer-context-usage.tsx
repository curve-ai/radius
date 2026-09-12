import type { ReactNode } from "react";

import type { ComposerContextUsagePresentation } from "@renderer/components/ai/composer-session-features";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip";

export function ComposerContextMeter({
  usage,
}: {
  usage: ComposerContextUsagePresentation;
}): ReactNode {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="meter"
          tabIndex={0}
          aria-label={usage.accessibleLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={usage.percentageUsed}
          className="relative hidden size-4 shrink-0 rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:block"
          style={{
            background: `conic-gradient(var(--muted-foreground) ${usage.percentageUsed}%, var(--border) 0)`,
          }}
        >
          <span
            aria-hidden
            className="absolute inset-0.5 rounded-full bg-background"
          />
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={8}
        className="w-auto min-w-40 rounded-[1rem] text-center shadow-md"
      >
        <p className="text-sm leading-5 text-muted-foreground">
          Context window:
        </p>
        <p className="text-sm leading-5 text-foreground">
          {usage.percentageUsed}% used ({usage.percentageLeft}% left)
        </p>
        <p className="text-sm leading-5 text-foreground">
          {usage.usedLabel} / {usage.sizeLabel} tokens used
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
