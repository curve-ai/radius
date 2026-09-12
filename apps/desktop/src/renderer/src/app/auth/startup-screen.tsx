import { Wordmark } from "@renderer/components/ui/wordmark";
import { Button } from "@renderer/components/ui/button";
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "@renderer/components/ui/motion";

export const STARTUP_EASE = [0.23, 1, 0.32, 1] as const;

export function StartupScreen({
  label,
  failed,
  retry,
}: {
  label: string;
  failed: boolean;
  retry: () => void;
}): ReactNode {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="radius-startup-screen"
      key="loading"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.1 : 0.16, ease: STARTUP_EASE }}
    >
      <header
        className="absolute inset-x-0 top-0 h-12 [app-region:drag]"
        onDoubleClick={() => void window.radius.handleTitlebarDoubleClick()}
      />
      <main
        className="flex min-h-dvh items-center justify-center"
        aria-busy={!failed}
      >
        <div className="text-center">
          <div
            className="radius-startup-wordmark"
            aria-hidden="true"
            data-failed={failed || undefined}
          >
            <Wordmark
              label={label}
              size="lg"
              className="radius-startup-wordmark-base"
            />
            <span className="radius-startup-shine-window">
              <span className="radius-startup-shine-text">
                <Wordmark label={label} size="lg" />
              </span>
            </span>
          </div>
          <p role="status" className="sr-only">
            {failed ? `${label} could not finish loading.` : `Loading ${label}`}
          </p>
          {failed && (
            <Button
              variant="link"
              className="mt-6 min-h-11 text-muted-foreground"
              onClick={retry}
            >
              Try again
            </Button>
          )}
        </div>
      </main>
    </motion.div>
  );
}
