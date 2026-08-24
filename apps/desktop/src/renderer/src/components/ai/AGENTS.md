# Radius AI component guidance

## Purpose

- This folder owns reusable renderer components for composing and presenting
  AI interactions, including prompts, messages, tool activity, approvals, and
  artifacts.
- Keep these components product-neutral and independently composable. Pages
  decide placement; shell components own navigation and window chrome.

## Boundaries

- Do not import Electron main-process modules, preload internals, storage
  clients, sync providers, Cloud code, or workspace-shell components.
- Accept typed props and callbacks for behavior. A component may own ephemeral
  UI state such as an uncontrolled draft, but it must not persist or transmit
  prompts itself.
- Prefer controlled APIs when a parent needs to coordinate state. Support an
  uncontrolled default only when it keeps the component useful in isolation.
- Keep runtime-specific agent lists, permission policy, workspace discovery,
  attachment persistence, and attachment transmission outside the component.
  The composer may own picker/popover state and render caller-owned `File`
  objects through typed callbacks.
- Follow the filings-reader geometry for primary AI workspaces: the page canvas
  uses `max-w-page`, while conversation content and the composer use the stable
  `max-w-reader` measure. The shell, not the AI component, reserves room for a
  contextual right panel.

## Interaction and visual rules

- Use the semantic tokens, type utilities, icon family, and shared primitives
  defined by the Radius design system. Do not create a second AI-specific
  theme.
- Preserve keyboard and screen-reader behavior. Multiline prompt inputs submit
  with Enter and insert a newline with Shift+Enter when submission is enabled.
- Expose accessible labels for icon-only actions and retain visible focus
  states. Attachment, access, and agent selection remain semantic, focusable
  buttons whose effects are supplied by typed callbacks. Effectful submit
  actions stay disabled until their required state and callback are available.
- Composer footer controls share one 32px height and vertical center. The send
  action stays visibly disabled for an empty draft. Center project-strip
  contents as one row and align their inset with the composer's content column.
- Access selection exposes only supported policies; do not show placeholder
  policy choices. Agent selection lists caller-provided connected agents
  directly without model/effort configuration submenus.
- `ComposerContextMenu` owns the reusable popover geometry for contextual
  choices that open above the composer. Callers own its data and actions. Build
  interactive menu rows from the complete `ActionToolPanelButton`, icon,
  content, label, and optional metadata composition so composer menus and the
  right-side tool panel keep one row grammar. The menu surface is a compact
  `bg-background` canvas with one quiet outer border; separate groups with
  labels and spacing, not divider hairlines. Keep the surface flush with its
  composer trigger.
- File previews are ephemeral UI. Revoke every object URL, support removal by
  keyboard and pointer, and never persist, upload, or read file contents in the
  presentation component. The owning page may make its full canvas a drop zone
  and passes accepted files into the composer. Renderer CSP permits `blob:`
  only for `img-src` so local image thumbnails can render; do not broaden that
  exception to scripts, frames, connections, or other resource types.
- Keep motion brief, purposeful, and compatible with reduced-motion settings.
- Do not render or store raw chain-of-thought. Components may present concise
  reasoning summaries supplied by a trusted caller.
