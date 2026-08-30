# 004 — Animate run completion state

- **Status**: DONE
- **Commit**: d04af22
- **Severity**: MEDIUM
- **Category**: State indication; cohesion
- **Estimated scope**: 1 source file, about 35 lines

## Working-tree prerequisite

This plan shares `session-thread.tsx` with plan 001 and targets the pending
two-level trace UI. Execute plan 001 first. If `TraceRow` and the collapsed
`RunTrace` group are absent, STOP instead of adapting this plan to stale source.

## Problem

When a run becomes terminal, the thinking grid disappears and the label,
duration, and horizontal geometry jump directly to the settled Worked state.

```tsx
// apps/desktop/src/renderer/src/components/ai/session-thread.tsx:316 — current
const header = (
  <>
    {working ? (
      <ThinkingGrid />
    ) : state === "failed" ? (
      <CircleAlert className="size-3.5 text-negative" aria-hidden />
    ) : null}
    <span
      role={working ? "status" : undefined}
      className={cn(
        "text-sm font-normal",
        working ? "radius-thinking-label" : "text-muted-foreground",
      )}
    >
      {label}
    </span>
    <span className="text-sm font-normal tabular-nums text-muted-foreground">
      {completed ? `Worked for ${duration}` : duration}
    </span>
  </>
);
```

Completion happens once per run. A short transition makes the state change
legible; it must not animate the live timer every 100ms.

## Target

- Transition only when the coarse run state changes, never when `duration`
  updates.
- Thinking/error indicator exit: `opacity: 0`, `scale(0.96)` over `100ms`.
- Incoming indicator, label, and settled duration: `opacity: 0`,
  `translateY(2px)` to settled over `160ms`.
- Easing: `[0.23, 1, 0.32, 1]`.
- Reposition label and duration with a `160ms` position-layout transition using
  the same ease when the leading indicator disappears.
- Reduced motion: `100ms` opacity only; no scale, translation, or position
  interpolation.
- Preserve the deliberate absence of a completed checkmark.

## Repo conventions to follow

- Reuse motion imports introduced by plan 001.
- Follow `InlineFeedbackTransition` at
  `apps/desktop/src/renderer/src/components/ui/inline-feedback-transition.tsx:18-45`
  for `160ms` entry, `100ms` exit, and reduced-motion behavior.
- Use full `transform` strings, not Motion `x`, `y`, or `scale` shorthands.

## Steps

1. Derive a stable state key such as `working`, `failed`, `cancelled`, or
   `completed`. Do not include elapsed duration in the key.
2. Wrap the leading indicator slot in `AnimatePresence initial={false}
mode="popLayout"` and render keyed `motion.span` wrappers with the exact
   indicator transitions from Target.
3. Render label and duration as motion spans with position-only layout enabled
   outside reduced motion. Set `layoutDependency` to the coarse state key so
   timer ticks do not trigger measurement or animation.
4. Crossfade label wording on the coarse state change without changing font,
   color, baseline alignment, or live-region semantics.
5. Confirm nested group/item disclosures from plan 001 remain independent.

## Boundaries

- Do NOT animate elapsed timer ticks.
- Do NOT reintroduce a completed checkmark.
- Do NOT change run labels, duration formatting, event grouping, or status
  semantics.
- Do NOT alter the thinking pixel or shimmer keyframes.
- Do NOT add dependencies.

## Verification

- **Mechanical**:
  - `cd apps/desktop && bunx eslint src/renderer/src/components/ai/session-thread.tsx`
  - `cd apps/desktop && bun run typecheck:web`
  - `cd apps/desktop && bun run test`
  - Expected: all commands exit 0.
- **Feel check**: run an fx prompt through working → completed and a fixture or
  real path through working → failed.
  - The timer remains perfectly still between 100ms text updates.
  - Only the terminal transition animates.
  - Label and duration settle in `160ms` without a horizontal snap.
  - Group and item disclosure state remains unchanged at completion.
  - Reduced motion uses opacity only for `100ms`.
- **Done when**: completion reads as one quiet state change rather than a layout
  jump.
