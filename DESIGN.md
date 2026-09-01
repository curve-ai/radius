---
name: Radius Desktop Design System
description: The implemented visual language for the Radius Electron renderer. A warm editorial surface system, restrained slate-blue accent, Geist type, compact desktop density, and light and dark themes.
---

# Radius desktop design system

> Status: inherited and adapted from an established dashboard design baseline.
> Radius code and tokens are authoritative. The upstream implementation is
> provenance, not a live dependency.

Radius is a local-first desktop workbench. It should feel calm, precise, and
native to sustained technical work. The interface uses warm neutral surfaces,
quiet borders, one restrained slate-blue accent, compact controls, and clear
information hierarchy without visual shouting.

## Source of truth

| Concern                                            | Location                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| Semantic tokens, themes, type ramp, radii, shadows | `apps/desktop/src/renderer/app/globals.css`                         |
| Theme preference and system synchronization        | `apps/desktop/src/renderer/src/lib/theme.ts`                        |
| Appearance control                                 | `apps/desktop/src/renderer/src/components/ui/theme-switch.tsx`      |
| Segmented selection                                | `apps/desktop/src/renderer/src/components/ui/segmented-control.tsx` |
| Shared Tailwind utilities                          | `apps/desktop/src/renderer/styles/utils.css`                        |
| Electron window and titlebar rules                 | `apps/desktop/src/renderer/src/index.css`                           |
| Reusable UI primitives                             | `apps/desktop/src/renderer/src/components/ui/`                      |
| Workspace composition                              | `apps/desktop/src/renderer/src/components/shell/`                   |
| Page composition                                   | `apps/desktop/src/renderer/src/app/`                                |
| UI copy and adaptation record                      | `docs/architecture/upstream-desktop-ui-provenance.md`               |

When this file and the implementation disagree, inspect the shipped interface,
fix the implementation or this document deliberately, and keep both aligned.
Do not silently create a second visual system.

## Core rules

- Use semantic tokens. Do not add raw colors when an existing token expresses
  the role.
- Use shared primitives and shell patterns before creating a parallel component
  or interaction model.
- Keep one visual theme across the window. Light and dark are both first-class.
- Use the slate-blue brand color sparingly. It is emphasis, not decoration.
- Prefer spacing, alignment, surface tone, and hairlines over heavy shadows.
- Keep cards and panels purposeful. Do not put every content group in a card.
- Preserve compact desktop density without sacrificing touch targets, focus
  visibility, readable contrast, or keyboard access.

## Typography

Geist is the interface typeface. Geist Mono is reserved for code and content
that benefits from fixed-width alignment. Do not automatically use monospace
for identifiers, timestamps, or numbers.

### Use less weight

The defining typography restriction is simple: hierarchy comes from size,
space, position, and color, not boldness.

- Page titles, panel titles, section headings, and display text use weight 400.
- Do not use `font-bold`, `font-semibold`, or `font-extrabold` on page, panel,
  section, dialog, sheet, or empty-state headings.
- Use `font-medium` only for small functional labels that need differentiation,
  such as a compact field label, active navigation item, or small card title.
- Body copy remains weight 400. Use `text-muted-foreground` for secondary
  hierarchy instead of reducing readability or increasing weight elsewhere.
- Do not bold a phrase inside a heading. Use the same weight with restrained
  color or italics only when emphasis is genuinely necessary.
- Existing copied primitives and legacy content styles may contain semibold or
  bold declarations. They are compatibility points, not precedent. Do not
  spread them into new Radius UI, and prefer regular or medium weight when
  revising those components.
- The compact Radius wordmark may retain its deliberate brand treatment. That
  exception does not apply to navigation, page titles, or ordinary labels.

When in doubt, make the text smaller and lighter. Never solve weak hierarchy by
making a large heading heavier.

### Type ramp

Use the `type-*` utilities defined in `globals.css`. They are all weight 400.
Do not recreate them with ad hoc Tailwind size and weight combinations.

| Utility      | Size | Role                                      |
| ------------ | ---- | ----------------------------------------- |
| `type-base`  | 16px | Body and supporting copy                  |
| `type-md-sm` | 18px | Small subheading                          |
| `type-md`    | 22px | Default workspace or section heading      |
| `type-md-lg` | 26px | Page title                                |
| `type-lg`    | 36px | Rare high-emphasis title or numeric value |
| `type-xl`    | 52px | Exceptional editorial surface only        |
| `type-2xl`   | 72px | Exceptional display surface only          |

The desktop shell should normally stay within `type-base` through
`type-md-lg`. Larger sizes are not default app-shell typography.

## Color and themes

The renderer uses semantic CSS variables and Tailwind mappings from
`globals.css`.

- Light mode uses a white canvas, warm near-black ink, and warm off-white
  surfaces.
- Light-mode popovers, dropdowns, and tooltips use the white canvas token with
  a quiet border and contextual shadow; cards retain the warmer card surface.
- Dark mode uses a deep warm near-black canvas with light warm ink.
- Appearance offers System, Light, and Dark. System is the default, follows
  operating-system changes while Radius is open, and explicit choices persist
  locally for future launches.
- `--brand` is the single slate-blue accent.
- `--positive`, `--negative`, and `--destructive` are semantic states. Do not
  reuse them as decorative accents.
- `--muted-foreground` carries secondary text hierarchy.
- `--accent` is the shared quiet hover and selected surface. Sidebar navigation
  is the exception: `--sidebar-accent` is a neutral darkening overlay so its
  state remains stable over native vibrancy instead of introducing a hue.
- `--border` and `--input` provide low-chroma hairlines.

Never introduce a second brand accent, generic AI gradient, neon glow, pure
black surface, or arbitrary light and dark values in component code.

## Surfaces, radii, and elevation

Radius uses one soft-corner scale derived from the 12px shared shadcn radius:

- Tiny details use 4px only when a larger curve would blur their geometry.
- Cards use 8px.
- Inputs, compact controls, action rows, and inline notices use 12px.
- Outgoing chat messages, dialogs, grouped content surfaces, the right tool
  panel, and selection popovers use 16px.
- The chat composer is the established 20px large-control exception.
- Buttons may use a pill shape when the existing button primitive calls for it.
- Shadows should be subtle and reserved for real elevation, such as a popover
  above the workbench. Prefer borders and surface contrast for static grouping.

Choose the radius by role rather than component origin so shared shadcn
primitives and Radius-owned composition resolve to the same physical curves.
Do not introduce radii above 20px, heavy black drop shadows, glassmorphism, or
stacked decorative cards.

### Popover row alignment

Compact selection popovers align their header and option icons on one optical
edge while allowing hover and selected backgrounds to use nearly the full
surface width:

1. Use the shared shadcn popover's 4px outer inset (`p-1`). This is the full
   horizontal margin around each option background.
2. Give the header an additional 4px inline inset (`px-1`). Its title and
   trailing link therefore sit on an 8px total content edge.
3. Do not add padding or horizontal margins to the option group. Each option
   background begins directly at the popover's 4px inset.
4. Give option rows 6px leading padding and 8px trailing padding
   (`pl-1.5 pr-2`). `ActionToolPanelItemIcon` centers the glyph in its shared
   wrapper, placing the visible icon on the header's optical edge while the
   trailing check aligns with the header action.
5. Keep vertical density and inter-row spacing separate from this alignment.
   Use `py-2` and `gap-1` for the compact approval menu.

Reuse the complete `ActionToolPanelButton`, icon, content, label, and optional
metadata composition. Do not compensate with one-off transforms or alter the
shared shadcn popover default. Surfaces that need more room must declare their
own padding explicitly.

### Narrow-panel action rows

Every icon-led interactive row in a narrow sidebar, tool panel, popover, or
sheet uses the complete action-tool composition:
`ActionToolPanelButton`, `ActionToolPanelItemIcon`,
`ActionToolPanelItemContent`, `ActionToolPanelItemLabel`, and optional
`ActionToolPanelItemMeta`. This applies even when the containing surface is not
named a tool panel, including the Settings return row. Do not substitute the
generic `Button`, a raw `button`, or a one-off row treatment for this pattern.
Use the generic `Button` only for standalone calls to action, compact icon
buttons, or documented inline exceptions; use `ActionToolPanelItem` for a
non-interactive row.

Sidebar collection actions use Electron's native `Menu` through the reusable
`showNativeControlMenu` preload contract. The operating system owns menu
material, type metrics, row height, selection color, icon sizing, shadows,
accessibility, and screen-edge collision. Radius supplies only validated labels,
SF Symbols, separators, enabled states, and action identifiers. Right-click uses
the live pointer position; the overflow button uses its current rendered bounds
with the first native item positioned beneath that point. There is no DOM menu,
CSS material approximation, fixed side, or hard-coded popup offset.

The reusable composer selection panel is a compact selector, not an
icon-led tool menu. Both its category surface and side flyout inherit the same
4px outer inset. Category and option rows are single-line, 36px high, and
use 8px inline padding (`min-h-9 px-2 py-1`). They omit leading icons,
descriptions, and redundant flyout headings so labels and current values remain
the hierarchy. Secondary values remain muted on hover and keyboard focus. The
side flyout opens to the right with its vertical center aligned to the category
row, but only when the category has at least two choices. Clicking or pressing
Enter or Space on a multi-choice category cycles to the next option without
closing the first panel; hover or ArrowRight exposes the complete side list.
Zero or one choice renders a static category row without a chevron or hover
behavior. When Agent has no choices, its trailing value is replaced by the
setup-guide `Button` with the `link` variant inside the same row. This is a
documented exception to complete action-tool row composition.

## Desktop shell

The shell is one coordinated workspace, not a collection of independent pages.

- The left sidebar owns primary navigation and local workspace identity. It
  remains docked at every supported window width and never changes into an
  overlay sheet. It collapses fully off canvas only when explicitly toggled;
  Radius does not retain a desktop icon rail. Its workspace boundary is
  directly draggable between compact and expanded widths, with the chosen width
  retained locally and no permanently visible resize handle. At compact window
  sizes, the maximum sidebar width contracts to preserve at least 224px for the
  workspace canvas.
- The footer account/settings row is single-line. Its packaged-client update
  affordance stays at the trailing edge without changing account navigation.
  The exact state presentation and actions are defined in
  [`docs/design/desktop-update-states.md`](docs/design/desktop-update-states.md).
- The window title area owns sidebar collapse and in-app Back and Forward
  history. When the sidebar is collapsed it also exposes a quick New chat
  action. These controls remain separate from the draggable region and share
  the renderer navigation context. Workspace headers with visible content use
  a quiet bottom hairline. Their non-interactive surface is the native window
  drag region, including the operating system's standard titlebar click and
  double-click behavior. On macOS, the renderer forwards that double-click to
  the owning native window so Radius respects the user's titlebar preference
  and falls back to maximize or restore. Buttons, links, inputs, and editable
  titles remain non-draggable.
- The workspace sidebar keeps search plus the New chat, Scheduled, and Connectors
  destinations, followed by local projects and their recent sessions.
  Choosing a project selects its durable chat context; choosing New chat
  clears the active session without discarding the active project. Session rows
  are text-first beneath the folder heading, use the quiet selected surface when
  active, and disclose longer groups through Show more/less. Project session
  row surfaces remain full width; nesting comes from left content padding rather
  than a narrower offset row. They do not render a placeholder status ring. A
  muted loader appears at the trailing position only while that session's local
  runtime is actively working. Otherwise a solid brand dot appears only when a
  newer assistant message has not been read on this client, and clears when the
  session opens. Loader and unread status both yield on hover or keyboard focus
  to the Pin/Unpin and Archive actions; runtime state is never repurposed as
  unread state.
  Locally pinned sessions relocate into one global Pinned section above Projects
  and do not appear twice. Pin, unpin, and archive controls use the compact
  Capbase-derived row composition and appear only on row hover or keyboard
  focus. Right-clicking any chat row opens the same native menu as the active
  chat header; choosing Rename selects that chat and enters its durable in-place
  title editor. Pin relocation and archive removal use the established
  160-180ms list transition and honor reduced motion. Runtime, storage, sync,
  and platform controls remain contextual tools rather than primary navigation.
- Sessions without a project appear once in a Recents group below Projects.
  Recents is a peer navigation group, not a synthetic folder or project.
  Standalone sessions reuse the same active, status, pin, search, and Show more
  behavior as project sessions. Pinning moves them into the global Pinned group
  without duplicating them in Recents. Hovering or focusing the Recents heading
  reveals collection actions plus a New chat control. New chat clears project
  context so the next session remains standalone.
- A project heading reveals two compact trailing actions only while that
  heading is hovered, keyboard-focused, or has its native action menu open: More
  actions and New chat. Both use the session-row action geometry: 20px controls
  on a 24px center-to-center cadence, aligned to the same trailing columns as
  Pin/Unpin and Archive. New chat selects the project, clears the active session,
  and opens the project-scoped composer. The native project menu order is Pin,
  Edit, separator, Reveal in Finder, separator, Archive chats, separator, and
  Remove project. Reveal in Finder is omitted when the project has no linked
  source folder. Project pinning is a local sidebar preference; Archive chats
  and Remove project remain visible but disabled until their Radius behavior is
  defined. Because Electron exposes no native minimum-menu-width option, the
  project menu includes a non-visible measurement hint that compensates for the
  chat menu's Copy-submenu arrow gutter; visible labels and native metrics remain
  unchanged. Unsupported actions must not be simulated with no-op handlers.
  Escape closes the menu and restores focus to its trigger.
- The Radius/search row stays pinned directly below the native titlebar. Search
  and titlebar navigation use 28px hover targets, 14px optically centered
  icons, and 4px gaps. On macOS the native control origin is `(17px, 16px)`;
  titlebar navigation begins at `(88px, 9px)`, aligning every control on the
  same 23px center line. When the sidebar is collapsed, Collapse, Back,
  Forward, and New chat retain the shared 32px cadence. Views with a visible
  header body place a quiet divider before the current-view title; the
  title-free New chat canvas shows neither.
- The sidebar identity row sits one additional 8px spacing step below the
  titlebar chrome. Its search icon uses muted foreground until hover or active.
- The left sidebar uses one system-native material surface: a translucent
  `--sidebar` ramp over Electron's semantic macOS sidebar vibrancy, retaining
  substantial native transparency even at the workspace boundary. This is
  window chrome, not a reusable glass-card treatment. macOS supplies the blur;
  the sidebar must not use Chromium `backdrop-filter`. Selected navigation uses
  the neutral `--sidebar-accent` darkening layer rather than a color-tinted
  surface. Other platforms use the solid `--sidebar` fallback. Renderer theme
  changes must also update Electron `nativeTheme` so the native material and
  semantic tokens resolve to the same appearance.
- The sticky header owns the current view title and contextual tool controls.
- Long catalog views use an iOS-style large-title transition. Connectors begins
  with the regular-weight `type-lg` title in the page; as it scrolls beneath the
  48px shell header, the compact `type-base` title follows the scroll position
  with a 24-72px opacity/translate transition. Scrolling back reverses the same
  path. Reduced motion keeps the opacity cue and removes positional movement.
  Installing a remote connector leaves it in the existing Needs setup rows.
  Finish setup is a real compact row action: it may open the system browser for
  authorization, stays disabled with a Connecting label while the IPC request
  is active, and reports cancellation, timeout, verification, and connection
  errors in the page's existing inline alert. Successful discovery replaces
  the staged state with the connected account and exact enabled-tool count.
  Connection detail rows provide a direct Disconnect action. Custom connectors
  use the same setup states and actions rather than a parallel flow.
- New chat is the deliberate exception: it uses a quiet, title-free header and
  does not expose the right tool-panel trigger or rail. Its page owns a centered
  invitation and reusable bottom composer so the first action is writing. The
  invitation uses the regular-weight `type-md` scale below 640px, returns to
  `type-lg` above that breakpoint, and remains text-centered as it wraps. The
  page follows the filings-reader geometry: `max-w-page` for the available
  canvas and the stable 46rem `max-w-reader` measure for the invitation and
  composer. This keeps content centered in whatever canvas remains after shell
  panels. The
  composer is a deliberate large-control exception to the general radius ramp:
  its 20px boundary follows the prompt surface reference, while its project row
  uses a compact 14px top radius. Prompt and project text use the 14px control
  scale. Below 640px, footer actions become 28px icon-only controls so
  attachment, access, agent selection, and send remain available in one row.
  At 640px and above they return to a 32px height, and access and agent selection
  show their standard 14px interface labels. Every icon-only action retains an
  accessible label and title. The empty send state is visibly inactive. Access
  opens a compact policy popover containing only supported modes. Agent
  selection uses the reusable `ComposerSelectionPanel`: a compact category row
  shows its current value. Click, Enter, or Space cycles multiple agents, while
  hover or ArrowRight opens the complete flyout to the side. Its single-line
  rows omit icons and subtitles. The flyout appears only for two or more
  available agents delivered through the current distribution or assignment.
  With zero agents, the row shows the static No available agents value and the
  primary Agents destination owns status and authentication; with one, the row
  shows only the static selected value.
  Model appears only when the selected agent advertises at least one model.
  Thinking effort appears directly beneath it only when the selected model
  advertises supported levels through the desktop runtime contract. Changing
  Agent or Model resets Thinking effort to that model's declared default, and
  the selected level applies to the next prompt. Unsupported agents and models
  do not show a placeholder control. This avoids inventing unsupported
  configuration controls or a local connection flow.
  On the collapsed desktop trigger, resolved Model and Thinking effort appear
  together as muted metadata. A sole Agent name is omitted when both values are
  present because it adds no selection information; multiple Agents retain the
  active Agent name before that metadata. If either value is unavailable, the
  Agent name remains the visible fallback. Mobile keeps the icon-only trigger,
  while the accessible label always includes every known selection.
  Task selection lists only agents whose required tool interfaces are usable on
  the current computer. An installed agent that requires an unavailable MCP
  connector remains visible on the Agents management page with a plain reason
  and a path to Connectors, but is not offered as a selectable task agent.
  Agents with optional MCP support remain selectable; Radius omits unavailable
  connector-backed tools and does not register an empty MCP bridge.
  Composer popover titles use the 14px label scale; leading icons and selected
  checkmarks center against each complete option row. The access popover uses
  a forced 4px outer inset and an additional 4px header inset, aligning its
  heading and Learn more link on an 8px total edge. The project strip opens
  `ComposerContextMenu` above the input. It lists current
  projects and a Create new project action using the same complete action-row
  composition as the right-side tool panel. The menu owns presentation while
  the project page remains the source of truth for selection and creation.
  Create new project opens the shared dialog; optional source-folder selection
  stays inside that dialog. Selecting a project without linked folders must not
  open the native folder picker. The menu sits 4px above the trigger and its surface uses
  the white/background canvas, compact 4px padding, one quiet outer border, and
  no inter-group hairlines. Elevation follows the shared scale: the composer
  uses `shadow-sm`, focus raises it to `shadow-md`, and the contextual menu uses
  `shadow-md` above both. Project selection is optional; prompt, attachment,
  access, and agent controls remain available for standalone sessions. The
  paperclip opens a multi-file picker. Opening a new or existing chat focuses
  its prompt, and the full chat canvas accepts file drops plus file-bearing
  clipboard pastes. Attached images appear as removable thumbnail tiles while
  other files use removable filename tiles; previews remain local and
  ephemeral.
- Selecting a session restores the standard titled header and contextual tool
  panel, then presents its canonical local transcript at the shared
  `max-w-reader` measure. The transcript and composer share the same outer
  content edges; responsive page padding sits outside that measure. User
  prompts use one quiet 16px inset surface; assistant responses stay directly
  on the canvas so long exchanges remain readable. The session composer is a
  measured bottom overlay rather than a separate footer band: transcript
  content scrolls behind it, while matching bottom padding keeps the latest
  message visible at rest. A transparent backdrop-blur gradient begins almost
  clear at the composer's top edge and increases toward the bottom edge, where
  it reaches the full 10px blur. Scrolling transcript text therefore
  softens beneath the control without clouding the content above it. Reduced
  transparency replaces the blur with an opaque surface.
  Composer submission,
  agent-loading, and draft errors use the 12px inline-notice surface directly
  above the input; long diagnostic text stays contained and scrollable. Opening
  a session positions its transcript at the
  latest message immediately after the initial load. Later polling and composer
  resizing do not override the user's scroll position unless it was already at
  the bottom. The chat scroller always spans the full workbench, placing its
  quiet translucent scrollbar at the far window edge. When the desktop tool
  panel is visible, it overlays that scroller while a shared content inset keeps
  the transcript and composer out from beneath the panel. During native window
  or continuous shell resizing, Radius holds the last settled conversation and
  breakout-table measures, pauses layout motion and automatic scroll
  correction, then commits the final geometry once resizing stops. After submission, the
  outgoing prompt becomes a temporary turn anchor 24px below the transcript
  top through a smooth spatial scroll; reduced motion moves there immediately.
  Measured trailing space lets it arrive before the response, then contracts as
  the response grows. Radius follows the response only while
  the user has not started scrolling; wheel, touch, scrollbar drag, or scroll
  keys cancel following and remove the temporary space. The real response edge
  retains 24px above the composer, with only the platform's contained elastic
  overscroll beyond it. On macOS, the Electron window enables native scroll
  bounce while the transcript's contained overscroll prevents momentum from
  chaining into the workspace shell. Reduce Motion disables the elastic
  boundary. Message bodies render safe GFM Markdown while preserving
  the compact Radius type and spacing system. Prose, lists, quotes, headings,
  links, and code remain inside `max-w-reader`; assistant tables alone may break
  out to the padded workbench edge or the desktop tool-panel boundary. Common
  terminal tables using `│`, `─`, and `┼` are normalized outside fenced code and
  rendered through the shared shadcn `Table` primitives. Transcript tables use
  a plain header, regular 14px values, 12px horizontal and 10px vertical cell
  padding, a 44px header, and quiet single row separators. Columns and the
  bordered table shell stays at least as wide as the reader/chat measure while
  its columns retain intrinsic content sizing. The workbench edge is the
  maximum rather than a forced width, with horizontal scrolling reserved for
  genuinely wider data. Retain the outer border until the surrounding message
  treatment no longer needs it. A compact
  24px Expand table and Copy table controls use 12px icons in a vertical rail
  outside the table's right border. The rail appears on table hover or keyboard
  focus and remains visible on coarse pointers. Expanded tables use
  the shared near-full-window dialog and restore focus to their trigger on
  close. During an active response, main-process `agent_message_chunk` updates
  are exposed as one stable, ephemeral assistant event and replaced by the
  canonical persisted final event. Once a streamed table rule is complete,
  partial rows are padded to the known column count so cells fill in as chunks
  arrive without per-token animation or remounting. Streaming code remains
  plain source without Shiki work, Mermaid remains source-only, math remains
  literal, and remote image resolution stays deferred. The final event upgrades
  those bounded components once, enables their controls, and starts permitted
  remote resolution. Markdown flow never uses forward-looking last-child
  spacing that would restyle an earlier block after an append. Raw HTML is never hydrated.
  Fenced code uses a labeled Radius block with exact-source Copy and the shared
  near-full-window Expand treatment. Syntax highlighting loads after the plain
  source and falls back without blocking the transcript for unknown or large
  languages. Math uses bounded, non-trusting KaTeX output. Definition lists,
  message-local footnotes, task lists, typed callouts, and native details
  disclosures retain semantic keyboard behavior. Mermaid diagrams render
  lazily with strict configuration, bounded source, sanitized inert SVG, a
  readable source disclosure, and matching Copy/Expand controls. Raw Mermaid
  configuration directives and HTML labels remain disabled.
  Markdown headings use a clear compact six-level scale from 24px through 12px
  with restrained regular/medium weights and tighter tracking. Blockquotes and
  inline code follow the shadcn typography recipes at Radius density; thematic
  breaks use the shared Separator. Provider-rendered `│` source runs normalize
  back into fenced code so the existing shadcn-composed code surface retains
  syntax highlighting and Copy/Expand controls. Read-only task checkboxes align
  to the center of the first 24px text line while wrapped task copy remains
  top-aligned. Plain labels remain plain text regardless of the structures that
  follow them; only authored Markdown heading syntax establishes hierarchy.
  Non-code `│` runs normalize into one continuous blockquote with separated attribution.
  Provider `•` glyph runs normalize into semantic vertical Markdown lists even
  when the provider serializes several items into one soft-wrapped paragraph;
  list rows use a compact 20px line box without extra inter-item spacing.
  Explicit Markdown headings retain their authored level and source markers
  never appear in rendered heading text. Copy markdown uses this same completed
  normalization so repaired provider lists remain semantic when pasted
  elsewhere without inventing heading syntax.
  Remote Markdown images and web-link favicon metadata resolve only
  through the main process. That resolver pins public DNS results, rejects
  credentials and private or reserved addresses, follows at most three safe
  HTTPS redirects, reads only a bounded HTML prefix for metadata even when a
  page is large, caps all image bytes, allowlists image MIME types, sends no
  cookies or referrer, deduplicates in-flight work, and stores results in a
  bounded process cache. Web links retain exactly the label and destination the
  agent authored. Valid favicons may resolve during streaming and enter with a
  160ms blur/opacity transition. Site-declared light and dark variants follow
  the active color scheme, while an independently bounded root-favicon lookup
  survives unavailable page metadata; missing or broken favicons leave no placeholder
  glyph. Link underlines appear only on hover or keyboard focus. Project file
  links use 14px Material Icon Theme file-type artwork and
  may open only canonical files beneath that session's source folders. The
  renderer receives data URLs or typed metadata and never broadens `connect-src`
  or `img-src` to arbitrary hosts. Broken remote images collapse to a compact
  muted source link with a 14px broken-image glyph and authored alt text;
  blocked URLs and missing local artifacts use the same treatment without an
  unsafe destination.
  Assistant ACP image blocks are not flattened into message text. Radius
  validates and stores each bounded image as a content-addressed local image
  artifact and references it from the canonical message. Transcript images are
  compact previews: assistant images fit within a
  240px by 128px envelope, while user-message images fit within 160px by 96px.
  Consecutive output images form a compact wrapping row and continue on the
  next line when the available conversation width is exhausted.
  The thumbnail itself is the fullscreen trigger, with its 12px Expand glyph
  overlaid in the top-right corner on hover or keyboard focus. Image controls
  never reuse the table's outside rail. The shared fullscreen dialog is the
  only expanded treatment. Composer image
  attachments use 64px square tiles so several files remain scannable in one
  row. The attachment strip and prompt use the same 8px horizontal inset as the
  desktop control row, aligning their edges while keeping both sides compact.
  Their top and bottom insets follow that same 8px step; the empty desktop
  composer is 96px tall and its footer is 44px.
  Generated image artifacts use a screen-reader label without inventing a
  visible caption. Markdown images show their authored alt text as the quiet
  caption when one was supplied.
  The fx provider may serialize an image as a `▧`-prefixed Markdown link.
  Radius promotes that known form back into an image block. Before the fx state
  lease closes, bounded raster files beneath its `/opt/data` share are imported
  into the same content-addressed artifact store and the link is removed from
  final prose. HTTPS targets use the remote resolver. Historical provider
  `sandbox:` targets may read only beneath `.codex/generated_images`. Every path
  requires an allowlisted raster MIME, bounded bytes, and a matching signature.
  Agent-run activity is grouped separately from final messages and follows the
  provider-owned inline or collapsible presentation record. While a run is
  actively working, its compact 3x3 pixel wave, event-derived activity label,
  and elapsed timer communicate real work in progress. The label uses safe
  activity categories from canonical host and ACP events rather than raw
  command, path, or provider text. Approval and user-wait states interrupt
  immediately, keep the elapsed timer, and freeze the wave and text shimmer so
  Radius does not imply continued work. Visible reasoning, progress, tool, and error rows use one
  quiet truncated line per action until the user explicitly expands that
  individual row, which reveals its full wrapped detail. The run header controls
  only the visibility of the whole group. A populated live group starts expanded
  so current activity remains visible, then collapses once when the run reaches a
  terminal state unless the user already chose its disclosure state. Historical
  terminal groups start collapsed. An open action list is limited to 16rem with
  contained vertical scrolling. Completed runs settle to a static status.
  Reduced motion freezes the wave, removes label movement and blur, and does
  not stop the timer. Reasoning rows
  contain only stored concise summaries, never raw chain-of-thought. Transcript
  loading, empty, refresh-error, and stale-content states remain explicit. The
  session composer shows its fixed canonical project when one was selected at creation;
  standalone sessions omit the project brow rather than offering project
  reassignment from inside an existing conversation.
  Completed assistant messages expose one quiet Copy markdown action plus their
  local timestamp below the response. Today shows time; earlier in the current
  Monday-based week shows weekday and time; older messages in the current year
  show `MMM, DD` plus time; prior years show `MM/DD/YY` plus time. The full local
  date and time remains available as hover and accessible context. A completed
  canonical plan adds a quiet Plan completed status beside Copy on the run summary
  when supplied, otherwise on the run's last final assistant message. While a plan
  is active, a compact current-step chip sits
  above the session composer; pointer hover or keyboard focus reveals the full
  plan item list in one elevated popover. Radius shows plan items only and does
  not borrow code-diff counters from coding-agent clients. Retry, voting,
  reaction, and other generic message actions remain absent until Radius has
  real behavior for them.
- Creating a project uses one centered Radius-native dialog. A project name is
  required and source folders are optional. The dialog follows the compact
  grouped-row composition: one Source folders label and helper line, one 44px
  row per selected directory, and one final Add folder row. A selected row
  shows only its directory name and a remove action; its full path remains
  available as hover context. It does not add a second visible path or
  explanatory copy inside the group. Create remains available
  with only a name. Each selection is represented by a short-lived main-process
  capability rather than a renderer-authored filesystem grant. Cancel and close
  discard all unclaimed capabilities. Project editing reuses the same list to
  add or remove local source-folder bindings.
- The workspace header is a 48px native-density bar. Its current-view title
  uses the 16px base type style, and standalone actions use the same 28px
  target, 16px icon, and small-radius geometry as titlebar navigation. Session
  headers pair the project/chat icon, clickable title, and adjacent ellipsis on
  that same center line. Clicking the title edits it in place; Enter or blur
  commits through the durable session revision path and Escape cancels. The
  editor uses the title's intrinsic content width and matching inline padding,
  so entering edit mode does not move adjacent header controls; they move only
  when the title length changes. The ellipsis and header right-click open the
  native chat menu: Pin/Unpin, Rename, Mark as unread, Archive, separator,
  Share, Copy submenu, separator, and Open in new window. Pin/Unpin, Rename,
  Mark as unread, Archive, and supported Copy operations are real. Share and
  Open in new window remain disabled until their Radius behavior is defined.
  Existing keyboard shortcuts remain available, and the trigger stays separate
  from the editable title.
- The right tool panel owns contextual runtime and storage
  controls while task and session workspace views are visible. Its desktop
  surface begins directly beneath the workspace header and stays aligned with
  the trailing header trigger that opens it. Connectors uses the full content
  canvas and does not show the right tool panel or its trigger.
- Page content owns task-specific information and actions.
- Settings is a full-window takeover: the workspace chrome is replaced by a
  fixed left settings navigator and an independently scrolling content canvas.
  The navigator provides a clear return to the previous workspace view and
  must not be duplicated in the right tool panel. The current user-facing
  surface contains General/work defaults, Appearance, Permissions,
  Notifications, Apps & connections, and About & updates. Account &
  organization is intentionally omitted. Device/platform facts and sync
  provider topology are operational policy, not personal settings.
- Responsive behavior may move the right panel into a popover or sheet, but its
  interaction and information hierarchy must remain consistent.
- Keep Electron drag and no-drag regions correct when changing the header.

Do not create a second navigation grammar, duplicate contextual controls in the
page body, or imply that Radius requires Cloud for local operation.

### Settings roadmap

Settings may establish the intended information architecture before every
backend is wired, but unavailable controls must be disabled, clearly muted, and
honest about their state. Never attach no-op handlers. The work-focused
information architecture is:

1. **General** — appearance, default agent, task/project startup behavior, and
   whether Radius may keep the computer awake during active work.
2. **Permissions** — default approval mode, project/file boundaries, and clear
   read-only presentation of agent- or organization-managed restrictions.
3. **Notifications** — task completion, approval-required, scheduled-task
   failure, and background-work updates.
4. **Apps & connections** — connected work applications, granted scopes,
   reconnect/disconnect, and agent availability using user-facing language.
5. **About & updates** — installed version, update state/actions, release notes,
   source/license, and help/feedback.

Do not expose sync toggles, provider URLs, raw platform/device facts, MCP
terminology, terminal locations, hooks, Git, environments, or worktrees as
personal settings. Agents and Scheduled remain primary product destinations;
settings contain their defaults and notification policy, not duplicate pages.
Account & organization remains out of this scaffold until its user/org graph is
designed and approved.

## Components and states

- Compose the primitives in `components/ui/` before adding new primitives.
- Reusable prompt, message, approval, tool, and artifact presentation belongs
  in `components/ai/`; pages place it and runtime adapters provide behavior.
- A pending command or file approval appears inline beneath its active run
  header and remains visible while the ordinary run trace is collapsed. It
  shows the exact command and working folder, or the exact file path, with
  quiet Deny and Allow once actions. The surface reuses existing card,
  muted-code, button, focus, and semantic-state tokens. Resolved approvals
  collapse into ordinary trace history rather than leaving a permanent card.
- A pending MCP approval reuses the same inline surface and offers Deny, Allow
  once, Always allow tool when ACP advertises it, and Always allow server. The
  last choice is explicitly server-scoped, not a global Radius bypass.
  Remembered grants are listed as compact Settings rows with direct Revoke
  actions and complete loading, empty, and error states.
- Preserve accessible names, keyboard behavior, focus rings, and minimum target
  sizes.
- Every asynchronous surface needs an intentional loading, empty, success, and
  error state where those states are possible.
- User-facing agent errors use allowlisted, actionable Radius copy. Never show
  Electron IPC wrappers, database queries, SQL parameters, stack traces, or
  unrecognized provider diagnostics; fall back to a plain retry or restart
  message while retaining technical detail outside the renderer.
- Labels sit above form controls. Placeholder text is not a label.
- Destructive actions must be visually and verbally distinct from ordinary
  actions.
- Keep icon usage within the existing Radius icon family. Do not hand-draw
  decorative SVG icons for ordinary interface actions.

## Motion

Motion communicates feedback, hierarchy, or a state transition. It is not
ambient decoration.

- Reuse the motion helpers in `components/ui/motion.ts` and
  `components/ui/motion-features.ts`.
- Animate transform and opacity where possible.
- Keep shell transitions short and quiet.
- The Settings takeover uses an 8px left-origin offset with opacity over 160ms
  and the shared `[0.23, 1, 0.32, 1]` ease.
- File-drop feedback enters with opacity and a restrained `scale(0.99)` over
  125ms, then exits over 100ms. Attachment tiles enter over 160ms, exit over
  120ms, and reflow over 180ms using the movement curve
  `[0.77, 0, 0.175, 1]`.
- Inline errors and status feedback enter from a 2px vertical offset with
  opacity over 160ms and exit over 100ms. Project source-folder rows update
  without decorative motion so the compact list remains stable.
- Composer selection values use that same 2px/160ms replacement treatment
  inside the trailing metadata slot. Only the value moves; its category label,
  row geometry, and chevron remain stable. The outgoing value exits over
  100ms.
- Honor `prefers-reduced-motion` through the existing reduced-motion hooks and
  CSS rules. These Settings and transient-feedback transitions become
  opacity-only at 100ms; attachment reflow becomes immediate.
- Do not add perpetual motion, scroll hijacking, or decorative parallax to the
  desktop workbench.

## Review checklist

Before completing frontend work, verify:

- New headings use weight 400 and the shared type ramp.
- Bold or semibold text was not added as a shortcut for hierarchy.
- Colors, radii, shadows, and spacing use existing tokens and primitives.
- Light and dark modes preserve hierarchy and readable contrast.
- Keyboard navigation, visible focus, and accessible names still work.
- Compact and constrained window widths remain usable.
- Motion is brief, motivated, and reduced-motion safe.
- Radius remains independently useful without a Cloud account.

## Provenance and boundary

Radius lawfully reuses and adapts an established dashboard design baseline as
documented in `docs/architecture/upstream-desktop-ui-provenance.md`. The public
repository contains the resulting Radius implementation and documentation. It
must not contain Cloud product logic, credentials, customer data, private
plans, or hosted-service implementation.
