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
- Composer footer controls share one vertical center. Below 640px, attachment,
  access, agent, and send remain available as 28px icon-only controls with
  accessible labels and titles. At 640px and above, they return to the 32px
  treatment; access and agent show their standard 14px interface labels. The
  send action stays visibly disabled for an empty draft. Center project-strip
  contents as one row and align their inset with the composer's content column.
- Access selection exposes only supported policies; do not show placeholder
  policy choices. Agent selection uses `ComposerSelectionPanel`: its first
  surface lists compact selection categories. For categories with two or more
  options, click, Enter, or Space cycles to the next option without closing the
  first panel; hover or ArrowRight opens the complete side list. Both surfaces force a
  4px outer inset and use single-line 36px rows with 8px inline padding. This
  selector intentionally omits the icon element required by tool-action rows,
  along with option subtitles and a redundant flyout heading. Its side flyout
  opens to the right with its vertical center aligned to the category row only
  when at least two choices exist. Zero or one choice renders a static category
  row without a chevron or hover behavior. With zero Agent choices, replace the
  trailing value with the link-variant setup-guide button inside that row.
  Secondary values remain muted through hover and focus instead of inheriting
  the row's primary foreground color. Agent lists only caller-provided
  available agents and accepts
  a caller-provided empty-state guide link. Render that guide as a link-variant
  `Button`, not a selectable row. Product callers may omit that action when the
  primary Agents destination owns status and authentication. Render Model only
  when the selected agent advertises at least one model. Render Thinking effort
  only when the selected model advertises supported levels through the desktop
  runtime contract. Reset it to that model's declared default when Agent or
  Model changes, and send the selected value with the next prompt.
  When a category's selected value changes while the first panel remains open,
  animate only that trailing value with the shared 2px/160ms state-transition
  treatment. Reduced motion uses a 100ms opacity-only crossfade. Keep the
  accessible current value outside overlapping visual transition nodes.
  The collapsed desktop trigger shows Model and Thinking effort as muted
  metadata when both are resolved. With exactly one available Agent, omit its
  redundant visible name in that state. Keep the Agent name when multiple
  Agents are available or either configuration value is unavailable. The
  accessible label always includes every known Agent, Model, and Thinking
  effort value. Mobile remains icon-only.
  Composer popover titles use the 14px label scale, and leading/trailing icons
  center against the full option row rather than its first text line. The access
  popover inherits the shared 4px outer inset and adds a 4px header inset for an
  8px total header edge. Option backgrounds start at the
  outer inset, while 6px leading
  and 8px trailing row padding align the shared icon wrapper and check with the
  header. Its optional Learn more action accepts a caller-provided URL. The
  workspace page resolves public Cloud URLs from `VITE_RADIUS_CLOUD_WEB_URL`.
- `ComposerContextMenu` owns the reusable popover geometry for contextual
  choices that open above the composer. Callers own its data and actions. Build
  interactive menu rows from the complete `ActionToolPanelButton`, icon,
  content, label, and optional metadata composition so composer menus and the
  right-side tool panel keep one row grammar. The menu surface is a compact
  `bg-background` canvas with one quiet outer border; separate groups with
  labels and spacing, not divider hairlines. Keep a compact 4px separation from
  its composer trigger.
- Project context is optional. Prompt, attachment, access, and agent controls
  remain available without a selected project; selecting one only scopes the
  future session to its local root.
- File previews are ephemeral UI. Revoke every object URL, support removal by
  keyboard and pointer, and never persist, upload, or read file contents in the
  presentation component. The owning page may make its full canvas a drop zone
  and passes accepted files into the composer. Renderer CSP permits `blob:`
  only for `img-src` so local image thumbnails can render; do not broaden that
  exception to scripts, frames, connections, or other resource types. Tile
  entry/exit uses opacity plus scale, while position-only layout motion bridges
  reflow. Reduced motion keeps a 100ms opacity transition and disables movement.
- Keep motion brief, purposeful, and compatible with reduced-motion settings.
- Do not render or store raw chain-of-thought. Components may present concise
  reasoning summaries supplied by a trusted caller.
- Session transcripts consume typed canonical events through caller-owned
  read APIs. Group run activity without replacing event order, keep final
  messages outside collapsible traces, and honor provider-owned inline or
  collapsible presentation records. Visible reasoning, progress, tool, and error
  rows use one truncated line per action until the user explicitly expands that
  individual row, which reveals its full wrapped detail. The run header controls
  only whole-group visibility. Every populated group starts collapsed; its open
  action list is capped at 16rem and scrolls independently. Collapsed traces
  remove hidden rows from the accessibility tree with `aria-hidden` and `inert`.
- Session pages may use a submitted user message as a temporary scroll anchor.
  Reserve only the measured space needed to place that turn near the top, shrink
  it as the answer grows, and cancel automatic following on real user scroll
  intent. Removing follow mode must also remove the temporary spacer so the
  response edge remains the true scroll boundary.
- Show the pixel-grid thinking indicator only for a real non-terminal run.
  Reduced motion freezes its pixels while elapsed time may continue to update.
- Completed assistant messages expose the working Copy markdown action. When a
  canonical plan completes, place its quiet completion status beside Copy on
  the run summary when one is identified, otherwise on the run's last final
  assistant message. Do not add retry, voting, reaction, or other no-op message
  controls.
- Render message bodies as safe GFM Markdown without raw HTML hydration. Keep
  ordinary content within the shared reader measure. Assistant tables may use
  the page-owned workbench inset to break out to the available canvas; user and
  system tables remain constrained by their message surfaces. Normalize common
  unfenced terminal-table separators before parsing and compose table nodes with
  the shared shadcn `Table` primitives rather than parallel table markup. Keep
  transcript tables report-like: plain headers, regular values, roomy cells,
  quiet single separators, and the documented outer border. Table Expand and
  Copy actions use 24px targets with 12px icons in a vertical rail outside the
  table's right border. Reveal the rail on hover or keyboard focus, retain it on
  coarse pointers, and use the shared Tooltip and Dialog primitives with focus
  restoration.
- Treat code, math, diagrams, directives, media, and link previews as bounded
  Markdown components, not raw HTML. Code and Mermaid use exact-source Copy and
  the shared near-full-window Expand pattern. Keep plain source available while
  lazy syntax or diagram rendering loads or fails. KaTeX remains non-trusting;
  Mermaid remains strict, rejects embedded configuration, sanitizes SVG, and
  exposes a source disclosure. Typed callouts use the shared Alert composition,
  and details use native disclosure semantics with Escape restoration.
- Renderer Markdown must not fetch remote media or metadata. Resolve remote
  HTTPS images and user-triggered standalone-link previews through the typed
  preload contract. Main owns DNS pinning, private-address rejection,
  redirects, MIME and byte limits, timeouts, metadata cleanup, in-flight
  deduplication, and bounded caching. Keep data/blob image exceptions narrow and
  retain explicit loading, blocked, and unavailable presentation.
- Stream assistant text through one stable ephemeral message event rather than
  persisting token deltas. Replace that event in place for every chunk and use
  the same event ID for the final journal message. Progressive terminal tables
  may pad incomplete rows only while the event is streaming; completed messages
  retain strict table recognition. Keep per-token cell updates immediate rather
  than animating high-frequency data changes.
- While a canonical plan is active, show only its compact current-step status
  above the session composer. Reveal the complete item list on pointer hover or
  keyboard focus; never add code-diff counts or coding-client language.
