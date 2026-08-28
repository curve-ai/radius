"use client";

/**
 * Slim motion entry point. `m` components carry no animation features of
 * their own. They get the asynchronously loaded domMax bundle from the
 * <LazyMotion> mounted in AppProvider, with advanced feature registration
 * deferred to a browser-loaded chunk.
 *
 * Import motion primitives from HERE, not from "motion/react": LazyMotion
 * runs in strict mode, so a full `motion.*` component rendered inside it
 * throws in development. `m` is exported as `motion` so call sites keep
 * their natural JSX.
 */
export {
  m as motion,
  AnimatePresence,
  LayoutGroup,
  useReducedMotion,
  useInView,
  useAnimationControls,
} from "motion/react";
export type { Variants } from "motion/react";
