import type { ReactNode } from "react";

import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";

export function SettingsCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div
      className={cn(
        "mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border bg-background",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SettingsRow({
  label,
  description,
  descriptionLive = false,
  children,
  className,
}: {
  label: string;
  description: string;
  descriptionLive?: boolean;
  children?: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div
      className={cn(
        "flex min-h-[4.75rem] items-center justify-between gap-6 px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        <p
          className="mt-0.5 text-sm leading-5 text-muted-foreground"
          aria-live={descriptionLive ? "polite" : undefined}
        >
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

export function UnavailableSetting({
  label = "Coming soon",
  reason,
}: {
  label?: string;
  reason: string;
}): ReactNode {
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled
      title={reason}
      className="shrink-0"
    >
      {label}
    </Button>
  );
}
