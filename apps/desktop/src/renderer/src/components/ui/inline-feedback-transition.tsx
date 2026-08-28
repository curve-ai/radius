"use client";

import type { ReactElement, ReactNode } from "react";

import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "@renderer/components/ui/motion";

const INLINE_FEEDBACK_EASE = [0.23, 1, 0.32, 1] as const;

export function InlineFeedbackTransition({
  children,
}: {
  children: ReactElement | null;
}): ReactNode {
  const reduceMotion = useReducedMotion();
  const offsetTransform =
    reduceMotion === true ? "translateY(0px)" : "translateY(-2px)";

  return (
    <AnimatePresence initial={false}>
      {children ? (
        <motion.div
          key="inline-feedback"
          initial={{ opacity: 0, transform: offsetTransform }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          exit={{
            opacity: 0,
            transform: offsetTransform,
            transition: {
              duration: 0.1,
              ease: INLINE_FEEDBACK_EASE,
            },
          }}
          transition={{
            duration: reduceMotion === true ? 0.1 : 0.16,
            ease: INLINE_FEEDBACK_EASE,
          }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
