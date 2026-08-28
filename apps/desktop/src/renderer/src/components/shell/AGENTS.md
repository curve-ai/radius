# Radius shell guidance

The desktop-level instructions in `../../../../../AGENTS.md` and the repository
design system in `../../../../../../../DESIGN.md` also apply here.

## Native sidebar material invariant

- The workspace and settings left sidebars expose Electron's native macOS
  `sidebar` vibrancy through transparent renderer layers. macOS supplies the
  blur; do not add Chromium `backdrop-filter` to either sidebar.
- Keep `html`, `body`, `#root`, the shell wrapper, and every desktop sidebar
  ancestor transparent beneath `.radius-sidebar-material` and
  `.radius-settings-sidebar-material`. Main content canvases remain opaque.
- `WorkspaceSidebar` composes the copied `Sidebar` primitive with
  `collapsible="none"`. That primitive defaults its container to
  `bg-sidebar`, which conceals native vibrancy. The shell class must retain the
  explicit `bg-transparent!` override on the desktop `Sidebar` container.
- Do not fix this invariant by editing `components/ui/sidebar.tsx`; that file is
  synchronized from the verified upstream primitive set. Adapt it here in the
  shell composition.
- If the copied primitive or shell structure changes, trace the computed
  backgrounds from `.radius-sidebar-material` through `html`. The material's
  parent, sidebar wrapper, root, body, and html must all compute to transparent.
- Preserve the solid `--sidebar` fallback outside macOS and when reduced
  transparency is requested.

## Navigation states

- Sidebar hover and selected states use the neutral darkening
  `--sidebar-accent` token. Do not replace it with the shared color-tinted
  `--accent`, a brand fill, or a second selection color.
- Keep `isActive`, `data-active`, and `aria-current="page"` synchronized. The
  selected state must remain distinguishable in light and dark themes without
  relying on color alone.

## Workspace session list

- `workspace-sidebar.tsx` owns sidebar chrome and primary destinations.
  `workspace-session-list.tsx` owns project, pinned-session, and recent-session
  collections together with their row actions and layout transitions. Keep
  session collection behavior out of the chrome component.
- Session rows use the compact Capbase-derived action grammar: pin or unpin at
  the inner trailing position, archive at the outer trailing position, and both
  controls hidden until hover or keyboard focus on fine-pointer desktop input.
  Preserve visible controls on coarse pointers and full keyboard access.
- Do not render an empty status ring or repurpose runtime state as unread state.
  The only trailing circle is a solid `--brand` unread marker derived from
  the latest assistant message being newer than this client's last-read
  timestamp.
- Pin relocation and archive removal use Motion layout transitions with the
  shared `(0.23, 1, 0.32, 1)` curve at 180ms and 160ms respectively. Keep the
  opacity and transform exit at 120ms, and collapse layout motion under reduced
  motion.
- Project headings and the Recents heading reveal trailing actions on hover or
  keyboard focus. The overflow menu owns management actions. The separate
  square-compose control always starts a new chat: project headings select that
  project first, while Recents clears project context for a standalone chat.
  Do not reuse the compose control for rename or edit.

## Available verification

- Run verification only when Alexey explicitly requests it. Available checks
  include the desktop typecheck, lint, tests, and package commands from
  `radius/`, plus the relevant sidebar surface in an actual preload-backed
  Electron window.
- A requested appearance-specific check should use the mode relevant to the
  change or reported issue. Run a multi-theme matrix only when Alexey asks for
  one.
- For deterministic regression checks, start Electron with a remote debugging
  port and inspect computed styles. A valid workspace trace has:
  - `.radius-sidebar-material` with the translucent gradient and no backdrop
    filter;
  - its `[data-slot="sidebar-container"]` parent with a transparent background;
  - `[data-slot="sidebar-wrapper"]`, `#root`, `body`, and `html` transparent.
- Renderer CSS changes use Vite HMR. Main-process transparency or vibrancy
  changes require a fresh Electron window; distinguish stale dev or packaged
  windows before diagnosing the material.
