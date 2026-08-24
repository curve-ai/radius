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

| Concern                                            | Location                                                       |
| -------------------------------------------------- | -------------------------------------------------------------- |
| Semantic tokens, themes, type ramp, radii, shadows | `apps/desktop/src/renderer/app/globals.css`                    |
| Theme preference and system synchronization        | `apps/desktop/src/renderer/src/lib/theme.ts`                   |
| Appearance control                                 | `apps/desktop/src/renderer/src/components/ui/theme-switch.tsx` |
| Shared Tailwind utilities                          | `apps/desktop/src/renderer/styles/utils.css`                   |
| Electron window and titlebar rules                 | `apps/desktop/src/renderer/src/index.css`                      |
| Reusable UI primitives                             | `apps/desktop/src/renderer/src/components/ui/`                 |
| Workspace composition                              | `apps/desktop/src/renderer/src/components/shell/`              |
| Page composition                                   | `apps/desktop/src/renderer/src/app/`                           |
| UI copy and adaptation record                      | `docs/architecture/upstream-desktop-ui-provenance.md`          |

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
- Dark mode uses a deep warm near-black canvas with light warm ink.
- Appearance offers System, Light, and Dark. System is the default, follows
  operating-system changes while Radius is open, and explicit choices persist
  locally for future launches.
- `--brand` is the single slate-blue accent.
- `--positive`, `--negative`, and `--destructive` are semantic states. Do not
  reuse them as decorative accents.
- `--muted-foreground` carries secondary text hierarchy.
- `--accent` is the shared quiet hover and selected surface.
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

## Desktop shell

The shell is one coordinated workspace, not a collection of independent pages.

- The left sidebar owns primary navigation and local workspace identity. It
  collapses fully off canvas; Radius does not retain a desktop icon rail. Its
  workspace boundary is directly draggable between compact and expanded widths,
  with the chosen width retained locally and no permanently visible resize handle.
- The footer account/settings row is single-line. A circular brand-colored
  download action appears at its trailing edge only when the packaged client
  confirms a newer Radius release; downloading and restart-to-install states
  retain the same compact footprint. Both visible circles are 16px beside the
  14px label; the download action retains a larger invisible pointer target.
- The window title area owns sidebar collapse and in-app Back and Forward
  history. When the sidebar is collapsed it also exposes a quick New chat
  action. These controls remain separate from the draggable region and share
  the renderer navigation context.
- The workspace sidebar keeps search plus the New chat, Scheduled, and Plugins
  destinations, followed by one-root local projects and their recent sessions.
  Choosing a project selects its folder-backed context; choosing New chat
  clears the active session without discarding the active project. Session rows
  are text-first beneath the folder heading, carry status at the trailing edge,
  use the quiet selected surface when active, and disclose longer groups through
  Show more/less. Locally pinned sessions relocate into one global Pinned
  section above Projects and do not appear twice; pin and unpin controls remain
  quiet until row hover or keyboard focus. Runtime, storage, sync, and platform
  controls remain contextual tools rather than primary navigation.
- Sessions without a project appear once in a Recents group below Projects.
  Recents is a peer navigation group, not a synthetic folder or project.
  Standalone sessions reuse the same active, status, pin, search, and Show more
  behavior as project sessions. Pinning moves them into the global Pinned group
  without duplicating them in Recents.
- A project heading reveals two compact trailing actions only while that
  heading is hovered, keyboard-focused, or has its action popover open: More
  actions and Edit. The More popover is a single elevated surface with grouped
  Pin, Edit, Finder, chat-state, and removal actions separated by sparse
  hairlines. Project pinning is a local sidebar preference. Undefined unread,
  bulk archive, and removal semantics remain visible but disabled with reasons;
  they must not be simulated with no-op handlers. Escape closes the popover and
  restores focus to its trigger.
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
  `--sidebar` ramp over Electron's semantic macOS sidebar vibrancy, becoming more opaque
  at the workspace boundary for legibility. This is window chrome, not a
  reusable glass-card treatment. macOS supplies the blur; the sidebar must not
  use Chromium `backdrop-filter`. Other platforms use the solid `--sidebar`
  fallback. Renderer theme changes must also update Electron `nativeTheme` so
  the native material and semantic tokens resolve to the same appearance.
- The sticky header owns the current view title and contextual tool controls.
- New chat is the deliberate exception: it uses a quiet, title-free header and
  does not expose the right tool-panel trigger or rail. Its page owns a centered
  invitation and reusable bottom composer so the first action is writing. The
  page follows the filings-reader geometry: `max-w-page` for the available
  canvas and the stable 40rem `max-w-reader` measure for the composer. This
  keeps content centered in whatever canvas remains after shell panels. The
  composer is a deliberate large-control exception to the general radius ramp:
  its 20px boundary follows the prompt surface reference, while its project row
  uses a compact 14px top radius. Prompt and project text use the 14px control
  scale. Footer actions share a 32px height; access and agent selection use the
  compact 12px control-label scale. Attachment/access/agent selection remain
  clear buttons, and the empty send state is visibly inactive. Access opens a
  compact policy popover containing only supported modes; agent selection
  opens a direct list of connected agents without model-setting drill-ins. The
  project strip opens `ComposerContextMenu` above the input. It lists current
  projects and a Create new project action using the same complete action-row
  composition as the right-side tool panel. The menu owns presentation while
  the project page remains the source of truth for selection and folder
  creation. Create new project opens the shared dialog; folder selection stays
  inside that dialog. The menu sits flush with the trigger and its surface uses
  the white/background canvas, compact 4px padding, one quiet outer border, and
  no inter-group hairlines. The paperclip opens a multi-file picker, and the
  full new-chat canvas accepts
  file drops. Attached images appear as removable thumbnail tiles while other
  files use removable filename tiles; previews remain local and ephemeral.
- Creating a project uses one centered Radius-native dialog before the macOS
  folder picker. The dialog pairs an editable project name with one explicit
  folder boundary, explains that Radius can read and edit everything beneath
  it, and keeps Create disabled until both values exist. The selected path is
  represented by a short-lived main-process capability rather than a
  renderer-authored filesystem grant. Cancel and close discard that capability.
- The workspace header is a 48px native-density bar. Its current-view title
  uses the 16px base type style, and standalone actions use the same 28px
  target, 16px icon, and small-radius geometry as titlebar navigation.
- The right tool panel owns contextual runtime, storage, sync, and platform
  controls while the workspace is visible.
- Page content owns task-specific information and actions.
- Settings is a full-window takeover: the workspace chrome is replaced by a
  fixed left settings navigator and an independently scrolling content canvas.
  The navigator provides a clear return to the previous workspace view and
  must not be duplicated in the right tool panel.
- Responsive behavior may move the right panel into a popover or sheet, but its
  interaction and information hierarchy must remain consistent.
- Keep Electron drag and no-drag regions correct when changing the header.

Do not create a second navigation grammar, duplicate contextual controls in the
page body, or imply that Radius requires Cloud for local operation.

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
  and the shared `[0.23, 1, 0.32, 1]` ease. Provider disclosure and asynchronous
  error feedback use a 2px vertical offset with opacity over 160ms; disclosure
  geometry settles over 180ms with the same ease.
- Honor `prefers-reduced-motion` through the existing reduced-motion hooks and
  CSS rules. These Settings transitions become opacity-only at 100ms.
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
