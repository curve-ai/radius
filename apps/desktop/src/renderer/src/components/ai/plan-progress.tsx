import {
  Check,
  Circle,
  CircleAlert,
  CircleDot,
  CircleSlash2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@renderer/components/ui/popover";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import {
  formatSessionPlanProgress,
  type SessionPlan,
  type SessionPlanStep,
} from "./session-transcript";

function StepIcon({ step }: { step: SessionPlanStep }): ReactNode {
  if (step.state === "completed") {
    return <Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />;
  }
  if (step.state === "in_progress") {
    return (
      <CircleDot className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
    );
  }
  if (step.state === "blocked") {
    return (
      <CircleAlert
        className="mt-0.5 size-4 shrink-0 text-negative"
        aria-hidden
      />
    );
  }
  if (step.state === "skipped") {
    return (
      <CircleSlash2
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
    );
  }
  return (
    <Circle
      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      aria-hidden
    />
  );
}

function PlanItems({ plan }: { plan: SessionPlan }): ReactNode {
  return (
    <ol aria-label={plan.title} className="flex flex-col gap-3">
      {plan.steps.map((step) => (
        <li
          key={step.id}
          className="flex items-start gap-3 text-sm leading-5 text-muted-foreground"
        >
          <StepIcon step={step} />
          <span
            className={cn(step.state === "in_progress" && "text-foreground")}
          >
            {step.title}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function PlanProgress({
  plan,
  placement = "composer",
}: {
  plan: SessionPlan;
  placement?: "composer" | "message";
}): ReactNode {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = (): void => {
    if (closeTimer.current === null) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const show = (): void => {
    cancelClose();
    setOpen(true);
  };
  const hide = (): void => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, 100);
  };

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const label = formatSessionPlanProgress(plan);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Button
          type="button"
          variant={placement === "composer" ? "outline" : "ghost"}
          size={placement === "composer" ? "default" : "xs"}
          aria-expanded={open}
          aria-label={`${label}. Show plan items`}
          onBlur={hide}
          onFocus={show}
          onPointerEnter={show}
          onPointerLeave={hide}
          className={cn(
            "text-muted-foreground hover:text-foreground",
            placement === "composer" &&
              "gap-2 bg-background px-3 text-sm shadow-sm",
            placement === "message" && "gap-1.5 rounded-sm px-2 font-medium",
          )}
        >
          {plan.completed ? (
            <Check className="size-3.5 text-brand" aria-hidden />
          ) : (
            <Circle className="size-3.5 text-brand/50" aria-hidden />
          )}
          <span>{label}</span>
        </Button>
      </PopoverAnchor>
      <PopoverContent
        align="center"
        side="top"
        sideOffset={8}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={show}
        onPointerLeave={hide}
        className="w-[min(20rem,calc(100vw-2rem))] p-4"
      >
        <PlanItems plan={plan} />
      </PopoverContent>
    </Popover>
  );
}
