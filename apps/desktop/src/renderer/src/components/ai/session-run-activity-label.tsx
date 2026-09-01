import React, { useEffect, useRef, useState, type ReactNode } from "react";

void React;

import { AnimatePresence, motion } from "@renderer/components/ui/motion";
import { cn } from "@renderer/lib/utils";
import type { SessionRunActivity } from "./session-run-activity";

const TRANSCRIPT_STATE_EASE = [0.23, 1, 0.32, 1] as const;
const RUN_ACTIVITY_MINIMUM_HOLD_MS = 450;
const RUN_ACTIVITY_SIZER_LABEL = "Deleting project files";

export type DisplayedRunActivity = SessionRunActivity & { active: boolean };

function useDisplayedRunActivity(
  nextActivity: DisplayedRunActivity,
  holdWorkingChanges: boolean,
): DisplayedRunActivity {
  const [displayedActivity, setDisplayedActivity] = useState(nextActivity);
  const displayedAt = useRef<number | null>(null);
  const activityMatches =
    displayedActivity.key === nextActivity.key &&
    displayedActivity.label === nextActivity.label &&
    displayedActivity.active === nextActivity.active;
  const showImmediately =
    !holdWorkingChanges || !displayedActivity.active || !nextActivity.active;

  useEffect(() => {
    displayedAt.current ??= Date.now();
  }, []);

  useEffect(() => {
    if (activityMatches) return;

    const showNextActivity = (): void => {
      displayedAt.current = Date.now();
      setDisplayedActivity(nextActivity);
    };
    if (showImmediately || displayedAt.current === null) {
      showNextActivity();
      return;
    }

    const remainingHold = Math.max(
      0,
      RUN_ACTIVITY_MINIMUM_HOLD_MS - (Date.now() - displayedAt.current),
    );
    if (remainingHold === 0) {
      showNextActivity();
      return;
    }

    const timer = window.setTimeout(showNextActivity, remainingHold);
    return () => window.clearTimeout(timer);
  }, [activityMatches, nextActivity, showImmediately]);

  return !activityMatches && showImmediately ? nextActivity : displayedActivity;
}

export function SessionRunActivityLabel({
  live,
  nextActivity,
  reduceMotion,
}: {
  live: boolean;
  nextActivity: DisplayedRunActivity;
  reduceMotion: boolean;
}): ReactNode {
  const activity = useDisplayedRunActivity(nextActivity, !reduceMotion);
  const enterTransform = reduceMotion ? "translateY(0px)" : "translateY(2px)";
  const exitTransform = reduceMotion ? "translateY(0px)" : "translateY(-2px)";
  const blurred = reduceMotion ? "blur(0px)" : "blur(1.5px)";

  return (
    <span className="relative inline-grid shrink-0 text-sm font-normal">
      <span
        aria-hidden
        className="invisible col-start-1 row-start-1 whitespace-nowrap"
      >
        {live ? RUN_ACTIVITY_SIZER_LABEL : activity.label}
      </span>
      {live ? (
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {activity.label}
        </span>
      ) : null}
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={activity.key}
          aria-hidden={live || undefined}
          initial={{
            opacity: 0,
            transform: enterTransform,
            filter: blurred,
          }}
          animate={{
            opacity: 1,
            transform: "translateY(0px)",
            filter: "blur(0px)",
          }}
          exit={{
            opacity: 0,
            transform: exitTransform,
            filter: blurred,
            transition: {
              duration: 0.1,
              ease: TRANSCRIPT_STATE_EASE,
            },
          }}
          transition={{
            duration: reduceMotion ? 0.1 : 0.16,
            ease: TRANSCRIPT_STATE_EASE,
          }}
          className={cn(
            "absolute inset-0 block whitespace-nowrap",
            activity.active ? "radius-thinking-label" : "text-muted-foreground",
          )}
        >
          {activity.label}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
