# 001 — Animate individual trace-row disclosure

- **Status**: DONE
- **Commit**: d04af22
- **Severity**: MEDIUM
- **Category**: State indication; missed opportunity
- **Estimated scope**: 1 source file, about 45 lines

## Working-tree prerequisite

This plan was authored against a dirty working tree on top of `d04af22`.
`apps/desktop/src/renderer/src/components/ai/session-thread.tsx` must already
contain the two-level `RunTrace` and `TraceRow` disclosures shown below. If the
excerpt is absent in the execution worktree, STOP and report that the pending
transcript UI changes must be committed or carried over first.

## Problem

The individual action chevron animates, but changing from the compact line to
wrapped detail snaps the row height, text, icon alignment, and following rows.

```tsx
// apps/desktop/src/renderer/src/components/ai/session-thread.tsx:218 — current
return (
  <button
    type="button"
    aria-expanded={expanded}
    onClick={() => setExpanded((current) => !current)}
    className={cn(
      "flex min-h-7 w-full min-w-0 gap-2 rounded-sm py-1 text-left text-[0.78125rem] leading-5 transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-[0.99]",
      expanded ? "items-start" : "items-center",
      isError ? "text-negative" : "text-muted-foreground",
    )}
  >
    <span className={cn("shrink-0", expanded && "mt-0.5")}>{icon}</span>
    <span
      className={cn(
        "min-w-0 flex-1",
        expanded ? "break-words whitespace-normal" : "truncate",
      )}
    >
      {content}
    </span>
```

This disclosure is occasional and user-initiated. Motion helps identify which
row changed without moving unrelated transcript content for decoration.

## Target

- Animate the selected row’s layout and displaced sibling positions over
  `180ms` with `[0.77, 0, 0.175, 1]`.
- Replace compact/full text with an interruptible opacity and 2px vertical
  transition:
  - enter: `opacity: 0`, `translateY(2px)` to settled over `160ms`;
  - exit: `opacity: 0`, `translateY(-2px)` over `100ms`;
  - easing: `[0.23, 1, 0.32, 1]`.
- Animate only transforms and opacity. Do not tween `height`, `max-height`,
  margins, or padding directly.
- Under reduced motion, disable layout movement and use a `100ms` opacity-only
  replacement.
- Preserve `aria-expanded`, keyboard activation, error color, tool outcomes,
  one-line compact text, and the parent group’s 16rem scroll limit.

## Repo conventions to follow

- Import `AnimatePresence`, `motion`, and `useReducedMotion` from
  `@renderer/components/ui/motion`, never directly from `motion/react`.
- Follow the attachment transition in
  `apps/desktop/src/renderer/src/components/ai/chat-composer.tsx:365-408`:
  `layout`, transform/opacity-only entry and exit, `160ms` state duration,
  `180ms` layout duration, and explicit reduced-motion handling.
- Follow the compact value replacement in
  `apps/desktop/src/renderer/src/components/ai/composer-selection-panel.tsx:99-123`
  for `translateY(2px)` enter, `translateY(-2px)` exit, `160ms`/`100ms`, and
  `[0.23, 1, 0.32, 1]`.

## Steps

1. In `session-thread.tsx`, import `AnimatePresence`, `motion`, and
   `useReducedMotion` through the Radius motion entry point.
2. In `TraceRow`, call `useReducedMotion()` once and derive enter/exit transform
   strings that become `translateY(0px)` under reduced motion.
3. Replace the row’s native `button` with `motion.button`. Set `layout` to
   `false` for reduced motion and otherwise enable layout measurement keyed by
   `expanded`. Set the layout transition to `0.18` seconds with
   `[0.77, 0, 0.175, 1]`.
4. Give the icon, outcome, and chevron position-only layout treatment so Motion
   does not visually scale glyphs while the row grows.
5. Wrap the compact/full text slot in `AnimatePresence initial={false}
mode="popLayout"`. Render keyed `motion.span` nodes for compact and expanded
   states using the exact opacity/transform timings in Target.
6. Keep the existing text content, truncation, line wrapping, button semantics,
   and ChevronDown rotation unchanged.

## Boundaries

- Do NOT change transcript event grouping, persistence, copy behavior, or plan
  presentation.
- Do NOT change the parent Working/Worked group animation or 16rem cap.
- Do NOT add dependencies or import full `motion.*` from `motion/react`.
- Do NOT animate hover movement.
- If the prerequisite excerpt has drifted, STOP instead of improvising.

## Verification

- **Mechanical**:
  - `cd apps/desktop && bunx eslint src/renderer/src/components/ai/session-thread.tsx`
  - `cd apps/desktop && bun run typecheck:web`
  - `cd apps/desktop && bun run test`
  - Expected: all commands exit 0.
- **Feel check**: in Electron, open a Working/Worked group containing at least
  two actions and expand only the first action.
  - The first row opens without a height snap.
  - The second row moves once, smoothly, and remains readable.
  - Rapid repeated activation retargets from the current position rather than
    restarting.
  - At 10% DevTools playback speed, icons do not stretch or scale with the row.
  - With reduced motion enabled, geometry changes immediately but text still
    crossfades for `100ms`.
- **Done when**: individual disclosure feels connected to its row, no sibling
  flicker occurs, and all existing accessibility semantics remain intact.
