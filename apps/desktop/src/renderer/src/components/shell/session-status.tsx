import type { ReactNode } from "react";

import type { WorkspaceSessionRecord } from "@renderer/components/shell/project-context-value";
import { cn } from "@renderer/lib/utils";

export function SessionStatus({
  status,
  className,
}: {
  status: WorkspaceSessionRecord["status"];
  className?: string;
}): ReactNode {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center",
        className,
      )}
      aria-hidden
    >
      {status === "active" && (
        <span className="size-2.5 rounded-full border border-muted-foreground" />
      )}
      {status === "failed" && (
        <span className="size-2 rounded-full bg-negative" />
      )}
    </span>
  );
}
