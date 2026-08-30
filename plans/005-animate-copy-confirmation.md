# 005 — Animate Copy confirmation

- **Status**: DONE
- **Commit**: d04af22
- **Severity**: LOW
- **Category**: Feedback
- **Estimated scope**: 1 source file, about 20 lines

## Working-tree prerequisite

This plan shares `session-thread.tsx` with plans 001 and 004. Execute it after
those plans so imports and Motion wrappers are reconciled once. If the current
Copy/Check conditional differs from the excerpt below, STOP and report drift.

## Problem

Copy works and exposes the correct accessible label, but its visible icon
teleports from Copy to Check.

```tsx
// apps/desktop/src/renderer/src/components/ai/session-thread.tsx:134 — current
<Button
  type="button"
  variant="ghost"
  size="xs"
  aria-label={copied ? "Markdown copied" : "Copy markdown"}
  onClick={() => void copyMarkdown()}
  className="-ml-1 size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
>
  {copied ? (
    <Check className="size-3" aria-hidden />
  ) : (
    <Copy className="size-3" aria-hidden />
  )}
</Button>
```

Copy may be used tens of times per day, so feedback must remain nearly
imperceptible and cannot move or resize the button.

## Target

- Keep the icon slot fixed at `size-3`.
- Outgoing icon: `opacity: 0`, `scale(0.96)` over `80ms`.
- Incoming icon: `opacity: 0`, `scale(0.96)` to settled over `120ms`.
- Easing: `[0.23, 1, 0.32, 1]`.
- Reduced motion: `100ms` opacity-only crossfade.
- Preserve the 1.5-second reset, clipboard operation, tooltip content, and
  accessible name.

## Repo conventions to follow

- Reuse motion imports already present after plans 001 and 004.
- Use `AnimatePresence initial={false} mode="popLayout"` and full transform
  strings.
- Keep motion entirely inside the existing fixed-size Button.

## Steps

1. Add a fixed-size icon slot inside the Button.
2. Wrap keyed Copy and Check icons in `AnimatePresence initial={false}
mode="popLayout"` and `motion.span` wrappers.
3. Apply the exact enter/exit durations, ease, and reduced-motion branch from
   Target.
4. Keep `aria-hidden` on the glyph and leave the Button’s `aria-label` as the
   source of the accessible state announcement.

## Boundaries

- Do NOT animate or delay clipboard writing.
- Do NOT change the 1.5-second reset duration.
- Do NOT animate the whole button, tooltip, message, or action bar.
- Do NOT change Plan completed placement.
- Do NOT add dependencies.

## Verification

- **Mechanical**:
  - `cd apps/desktop && bunx eslint src/renderer/src/components/ai/session-thread.tsx`
  - `cd apps/desktop && bun run typecheck:web`
  - `cd apps/desktop && bun run test`
  - Expected: all commands exit 0.
- **Feel check**: click Copy repeatedly after each reset.
  - The icon crossfades inside a fixed slot without shifting the action bar.
  - Clipboard content is available immediately, before the animation completes.
  - At 10% playback, scale starts at `0.96`, never zero.
  - Reduced motion retains a `100ms` opacity crossfade with no scale.
- **Done when**: Copy feedback is legible, immediate, and quieter than the
  surrounding transcript content.
