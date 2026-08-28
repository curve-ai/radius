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

Radius has a restrained shape system:

- Cards use the small radius.
- Inputs, menus, and panels use the medium radius.
- Buttons may use a pill shape when the existing button primitive calls for it.
- Larger radii are rare and require an existing product pattern.
- Shadows should be subtle and reserved for real elevation, such as a popover
  above the workbench. Prefer borders and surface contrast for static grouping.

Do not introduce `rounded-2xl` or `rounded-3xl` product surfaces, heavy black
drop shadows, glassmorphism, or stacked decorative cards.

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
- The footer account/settings row is single-line. A circular brand-colored
  download action appears at its trailing edge only when the packaged client
  confirms a newer Radius release; downloading and restart-to-install states
  retain the same compact footprint. Both visible circles are 16px beside the
  14px label; the download action retains a larger invisible pointer target.
- The window title area owns sidebar collapse and in-app Back and Forward
  history. When the sidebar is collapsed it also exposes a quick New chat
  action. These controls remain separate from the draggable region and share
  the renderer navigation context.
- The workspace sidebar keeps search plus the New chat, Scheduled, and Connectors
  destinations, followed by one-root local projects and their recent sessions.
  Choosing a project selects its folder-backed context; choosing New chat
  clears the active session without discarding the active project. Session rows
  are text-first beneath the folder heading, use the quiet selected surface when
  active, and disclose longer groups through Show more/less. They do not render
  a placeholder status ring. A solid brand dot appears only when a newer
  assistant message has not been read on this client, and clears when the
  session opens.
  Locally pinned sessions relocate into one global Pinned section above Projects
  and do not appear twice. Pin, unpin, and archive controls use the compact
  Capbase-derived row composition and appear only on row hover or keyboard
  focus. Pin relocation and archive removal use the established 160-180ms list
  transition and honor reduced motion. Runtime, storage, sync, and platform
  controls remain contextual tools rather than primary navigation.
- Sessions without a project appear once in a Recents group below Projects.
  Recents is a peer navigation group, not a synthetic folder or project.
  Standalone sessions reuse the same active, status, pin, search, and Show more
  behavior as project sessions. Pinning moves them into the global Pinned group
  without duplicating them in Recents. Hovering or focusing the Recents heading
  reveals collection actions plus a New chat control. New chat clears project
  context so the next session remains standalone.
- A project heading reveals two compact trailing actions only while that
  heading is hovered, keyboard-focused, or has its action popover open: More
  actions and New chat. New chat selects the project, clears the active session,
  and opens the project-scoped composer. The More popover is a single elevated
  surface with grouped Pin, Rename, Finder, chat-state, and removal actions
  separated by sparse hairlines. Project pinning and read state are local
  sidebar preferences. Undefined bulk archive and removal semantics remain
  visible but disabled with reasons; they must not be simulated with no-op
  handlers. Escape closes the popover and restores focus to its trigger.
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
- New chat is the deliberate exception: it uses a quiet, title-free header and
  does not expose the right tool-panel trigger or rail. Its page owns a centered
  invitation and reusable bottom composer so the first action is writing. The
  invitation uses the regular-weight `type-md` scale below 640px, returns to
  `type-lg` above that breakpoint, and remains text-centered as it wraps. The
  page follows the filings-reader geometry: `max-w-page` for the available
  canvas and the stable 40rem `max-w-reader` measure for the invitation and
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
  the project page remains the source of truth for selection and folder
  creation. Create new project opens the shared dialog; folder selection stays
  inside that dialog. The menu sits 4px above the trigger and its surface uses
  the white/background canvas, compact 4px padding, one quiet outer border, and
  no inter-group hairlines. Elevation follows the shared scale: the composer
  uses `shadow-sm`, focus raises it to `shadow-md`, and the contextual menu uses
  `shadow-md` above both. Project selection is optional; prompt, attachment,
  access, and agent controls remain available for standalone sessions. The
  paperclip opens a multi-file picker, and the full new-chat canvas accepts
  file drops. Attached images appear as removable thumbnail tiles while other
  files use removable filename tiles; previews remain local and ephemeral.
- Selecting a session restores the standard titled header and contextual tool
  panel, then presents its canonical local transcript at the shared
  `max-w-reader` measure. User prompts use one quiet inset surface; assistant
  responses stay directly on the canvas so long exchanges remain readable.
  Agent-run activity is grouped separately from final messages and follows the
  provider-owned inline or collapsible presentation record. While a run is
  non-terminal, its compact 3x3 pixel wave and elapsed timer communicate real
  work in progress. Completed runs settle to a static status. Reduced motion
  freezes the wave without stopping the timer. Reasoning rows contain only
  stored concise summaries, never raw chain-of-thought. Transcript loading,
  empty, refresh-error, and stale-content states remain explicit. The session
  composer shows its fixed canonical project when one was selected at creation;
  standalone sessions omit the project brow rather than offering project
  reassignment from inside an existing conversation.
  Completed assistant messages expose one quiet Copy markdown action below the
  response. A completed canonical plan adds a quiet Plan completed status beside
  Copy on the run summary when supplied, otherwise on the run's last final
  assistant message. While a plan is active, a compact current-step chip sits
  above the session composer; pointer hover or keyboard focus reveals the full
  plan item list in one elevated popover. Radius shows plan items only and does
  not borrow code-diff counters from coding-agent clients. Retry, voting,
  reaction, and other generic message actions remain absent until Radius has
  real behavior for them.
- Creating a project uses one centered Radius-native dialog before the macOS
  folder picker. The dialog pairs an editable project name with one explicit
  folder boundary, explains that Radius can read and edit everything beneath
  it, and keeps Create disabled until both values exist. The selected path is
  represented by a short-lived main-process capability rather than a
  renderer-authored filesystem grant. Cancel and close discard that capability.
- The workspace header is a 48px native-density bar. Its current-view title
  uses the 16px base type style, and standalone actions use the same 28px
  target, 16px icon, and small-radius geometry as titlebar navigation.
- The right tool panel owns contextual runtime and storage
  controls while task and session workspace views are visible. Connectors uses
  the full content canvas and does not show the right tool panel or its trigger.
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
- Preserve accessible names, keyboard behavior, focus rings, and minimum target
  sizes.
- Every asynchronous surface needs an intentional loading, empty, success, and
  error state where those states are possible.
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
  opacity over 160ms and exit over 100ms. The create-project folder control
  uses the same 160ms state-change treatment inside its fixed geometry.
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
