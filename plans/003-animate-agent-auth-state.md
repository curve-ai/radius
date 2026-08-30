# 003 — Animate agent authentication state replacement

- **Status**: DONE
- **Commit**: d04af22
- **Severity**: MEDIUM
- **Category**: Feedback and state indication
- **Estimated scope**: 1 source file, about 35 lines

## Problem

After sign-in or sign-out, the status icon, explanatory text, and action button
replace immediately. This is a rare, consequential state change and currently
offers no visual bridge that Radius accepted the authentication result.

```tsx
// apps/desktop/src/renderer/src/app/workspace/agents-page.tsx:158 — current
const connected =
  agent.authentication.state === "connected" ||
  agent.authentication.state === "not_required";
const pending = pendingAgentId === agent.id;
const StatusIcon = connected ? CircleCheck : ShieldCheck;

<p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
  <StatusIcon className="size-3.5 shrink-0" aria-hidden />
  <span>{authenticationLabel(agent)}</span>
</p>;

{
  connected && agent.authentication.state !== "not_required" ? (
    <Button
      type="button"
      size="xs"
      variant="ghost"
      disabled={pending}
      onClick={() => void disconnect(agent.id)}
    >
      {pending ? "Signing out" : "Sign out"}
    </Button>
  ) : agent.authentication.state === "not_required" ? null : (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() => void connect(agent.id)}
    >
      {pending ? "Waiting for browser" : "Sign in"}
    </Button>
  );
}
```

## Target

- Crossfade only the status line and trailing action. Keep avatar, agent name,
  detail, row boundary, and row position stationary.
- Incoming state: `opacity: 0`, `translateY(2px)` to settled over `160ms`.
- Outgoing state: `opacity: 0`, `translateY(-2px)` over `100ms`.
- Easing: `[0.23, 1, 0.32, 1]`.
- Key replacements by authentication state and pending/non-pending phase, not
  by dynamic label text.
- Reduced motion: `100ms` opacity-only replacement.
- No bounce, color flash, confetti, or entire-row movement.

## Repo conventions to follow

- Import `AnimatePresence`, `motion`, and `useReducedMotion` from
  `@renderer/components/ui/motion`.
- Copy the replacement pattern from
  `apps/desktop/src/renderer/src/components/ai/composer-selection-panel.tsx:99-123`.
- Error entry is already handled elsewhere through Radius’s inline feedback
  pattern; do not duplicate it.

## Steps

1. Add the Radius motion imports and call `useReducedMotion()` once in
   `AgentsPage`.
2. Wrap the status icon/text slot in `AnimatePresence initial={false}
mode="popLayout"`. Use a keyed `motion.p` for the authentication state and
   exact enter/exit transitions from Target.
3. Wrap the trailing action slot in a fixed-width or position-preserving
   container so Sign in, Waiting for browser, Sign out, and no-action states do
   not shift the text column.
4. Add a keyed `motion.div` inside that container using the same timings.
5. Preserve `aria-live` behavior if present; do not add a second announcement.
   Keep button labels and disabled behavior unchanged.

## Boundaries

- Do NOT animate the whole agent row or initial list load.
- Do NOT change authentication calls, credential handling, error copy, or
  pending-state logic.
- Do NOT introduce positive-color celebration beyond existing semantic state.
- Do NOT add dependencies.

## Verification

- **Mechanical**:
  - `cd apps/desktop && bunx eslint src/renderer/src/app/workspace/agents-page.tsx`
  - `cd apps/desktop && bun run typecheck:web`
  - `cd apps/desktop && bun run test`
  - Expected: all commands exit 0.
- **Feel check**: use a testable agent authentication path in Electron.
  - Sign in and sign out states replace within `160ms` without moving the row.
  - The action remains immediately clickable once enabled.
  - Failure feedback is not hidden or delayed.
  - At 10% playback, only the status/action slots move by 2px.
  - Reduced motion keeps a `100ms` opacity transition and no translation.
- **Done when**: the rare authentication result is unmistakable but restrained.
