# 002 — Animate connector depth transitions

- **Status**: DONE
- **Commit**: d04af22
- **Severity**: MEDIUM
- **Category**: Spatial consistency; missed opportunity
- **Estimated scope**: 1 source file, about 70 lines

## Working-tree prerequisite

This plan targets the pending category-pagination implementation in the dirty
working tree. `connectors-page.tsx` must contain `selectedCategory`,
`selectedCatalogId`, and the three early-return surfaces shown below. If it
does not, STOP and report that the current connector work must be committed or
carried into the execution worktree first.

## Problem

Root catalog, category catalog, and connector detail replace one another
instantly. The user loses the spatial relationship between “Show more,” a
connector row, and Back.

```tsx
// apps/desktop/src/renderer/src/app/workspace/connectors-page.tsx:675 — current
if (selectedEntry) {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 pb-20 pt-7 sm:px-8 sm:pt-9">
      <ConnectorDetailView
        backLabel={
          selectedCategory ? CATEGORY_LABELS[selectedCategory] : "All connectors"
        }
        entry={selectedEntry}
        installed={selectedInstalled}
        tools={
          selectedInstalled &&
          enabledToolsState?.installationId === selectedInstalled.id
            ? enabledToolsState.tools
            : []
        }
        toolsLoading={Boolean(
          selectedInstalled &&
          enabledToolsState?.installationId !== selectedInstalled.id,
        )}
        pending={pendingAction !== null}
        onBack={() => setSelectedCatalogId(null)}
        onInstall={(id) => void installCatalogEntry(id)}
      />
    </section>
  );
}

// apps/desktop/src/renderer/src/app/workspace/connectors-page.tsx:704 — current
if (selectedCategory) {
  const categoryLabel = CATEGORY_LABELS[selectedCategory];
  return (
    <section className="mx-auto w-full max-w-6xl px-5 pb-20 pt-7 sm:px-8 sm:pt-9">
      <Button type="button" variant="ghost" size="sm" onClick={closeCategory}>
        <ArrowLeft className="size-3.5" aria-hidden />
        All connectors
      </Button>
```

```tsx
// apps/desktop/src/renderer/src/app/workspace/connectors-page.tsx:793 — current
return (
  <section className="mx-auto w-full max-w-6xl px-5 pb-20 pt-10 sm:px-8 sm:pt-12">
```

Navigation is occasional and pointer/button initiated, so a short directional
bridge improves orientation without slowing a high-frequency keyboard path.

## Target

- Introduce three keyed depths: root `0`, category `1`, detail `2`.
- Forward navigation enters from `translateX(8px)` and exits toward
  `translateX(-8px)`; Back reverses those directions.
- Animate opacity from `0` to `1` with the transform over `160ms` using
  `[0.23, 1, 0.32, 1]`.
- Use `AnimatePresence initial={false} mode="popLayout"` so outgoing content
  never blocks the incoming surface.
- Under reduced motion, use `translateX(0px)` and a `100ms` opacity-only
  transition.
- Animate only the page surface. Catalog rows, search results, pagination, and
  scrolling remain immediate and stationary.

## Repo conventions to follow

- Import motion primitives from `@renderer/components/ui/motion`.
- Follow the route transition structure in
  `apps/desktop/src/renderer/src/app/app.tsx:20-73`: keyed motion surface,
  `160ms`, `[0.23, 1, 0.32, 1]`, and `100ms` reduced-motion behavior.
- Preserve the existing `scrollTo({ top: 0 })` behavior in
  `connectors-page.tsx:571-587`.

## Steps

1. Import `AnimatePresence`, `motion`, and `useReducedMotion` from the Radius
   motion entry point; add refs/state needed to record previous and next depth.
2. Replace the three early returns with one computed `viewKey`, `viewDepth`,
   and `viewContent` React node. Use keys `root`, `category:<category>`, and
   `detail:<entry-id>`.
3. Update forward handlers (`openCategory`, `setSelectedCatalogId`) and Back
   handlers to record direction before changing selection state. Do not infer
   direction from render order after state has already changed.
4. Wrap `viewContent` in `AnimatePresence initial={false} mode="popLayout"`
   and one keyed `motion.div` using full transform strings, never Motion `x`.
5. Apply the exact timings and reduced-motion branch from Target.
6. Ensure focus still moves naturally through the new surface and all current
   dialog portals remain outside the keyed animation node.

## Boundaries

- Do NOT stagger or animate connector rows.
- Do NOT animate search, pagination, loading skeletons, or scroll position.
- Do NOT alter connector API requests, category state, installation behavior,
  dialog behavior, or URLs.
- Do NOT add dependencies.
- If the prerequisite state model is absent or materially different, STOP.

## Verification

- **Mechanical**:
  - `cd apps/desktop && bunx eslint src/renderer/src/app/workspace/connectors-page.tsx`
  - `cd apps/desktop && bun run typecheck:web`
  - `cd apps/desktop && bun run test`
  - Expected: all commands exit 0.
- **Feel check**: in Electron, navigate root → category → detail, then Back
  twice.
  - Forward motion consistently moves deeper by 8px; Back reverses it.
  - The transition completes in `160ms` and never delays clicking the new view.
  - At 10% playback, outgoing and incoming surfaces do not remain double
    exposed after the transition.
  - Search typing, Load more, and catalog scrolling show no added animation.
  - Reduced motion keeps the `100ms` opacity bridge with no horizontal travel.
- **Done when**: depth is legible in both directions and catalog reading remains
  completely still.
