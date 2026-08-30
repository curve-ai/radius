# Radius desktop guidance

## Visual system

- Invoke the `design-taste-frontend` skill before writing or editing renderer
  UI. Apply its design read, anti-slop checks, and accessibility rules while
  deferring to the implemented Radius product system. Its automatic validation
  protocols and landing-page patterns do not govern the desktop workbench.
- Read `../../DESIGN.md` before building, styling, or redesigning renderer UI.
  Keep page, panel, section, dialog, sheet, and empty-state headings at weight
  400. Use size, spacing, position, and color for hierarchy; do not add bold or
  semibold headings.
- Treat the implemented tokens and shared primitives as the source of truth.
  Keep `../../DESIGN.md` aligned when the visual system changes.
- Reuse or compose shipped primitives and interaction patterns before creating
  a parallel component or experience. Obtain user approval before building
  a materially new interaction model that the existing system cannot support.

## Renderer structure

- Keep the Vite renderer organized like the Cloud Next.js application:
  `src/renderer/src/app/<surface>/page.tsx` owns page content,
  `components/shell/` owns application chrome, and `components/ui/` owns copied
  or shared primitives.
- Keep Electron-only window behavior in `src/renderer/src/index.css`. Product
  tokens and component styling come from `src/renderer/app/globals.css` and
  `src/renderer/styles/utils.css`.
- Preserve the sandboxed preload boundary. Renderer code must not import Node,
  Electron main-process modules, Cloud implementation, or database clients.

## UI provenance

- Use `scripts/sync-dashboard-ui.sh` for the verified upstream primitive
  set. Do not hand-edit copied files in `components/ui/`; adapt product behavior
  in `components/shell/` or `app/`. The sync script owns the approved Radius
  padding adaptation that sets shared popover and tooltip content to a compact
  4px inset. When validation is requested, use the sync script's matching check
  for that transformation.
- Do not copy upstream repository instructions, business logic, data components,
  routes, credentials, or private product details into Radius.
- The Radius wordmark is text-only. Do not add the rotating loading cube or a
  replacement animated brand glyph.

## Action tool panel

- Interactive rows must use the complete action-panel composition:
  `ActionToolPanelButton`, `ActionToolPanelItemIcon`,
  `ActionToolPanelItemContent`, `ActionToolPanelItemLabel`, and optional
  `ActionToolPanelItemMeta`.
- Metadata beside a primary label uses `className="text-sm"` so both sides have
  the same size, matching the established tool-panel usage.
- Let `ActionToolPanelItemIcon` size icons. Do not add icon sizing classes in
  shell composition.
- Keep desktop rail fitting, compact popover presentation, keyboard shortcuts,
  and reduced-motion behavior in the shared shell.

## Electron interaction

- Keep draggable titlebar regions separate from all interactive controls.
- The skip-link target may remain programmatically focusable, but must never
  display a body-sized focus outline.

## Available validation

- Run these only when validation is explicitly requested, using the requested
  scope. They are not an automatic completion checklist.
- `bun run typecheck`
- `bun run lint`
- `bun run test`
- `bun run package`
- Live verification can cover the relevant workspace or settings surface in an
  actual preload-backed Electron window.
