# Desktop UI provenance

Radius reuses an established dashboard design system from a local source
frontend while remaining an independent Electron/Vite application. The public
Radius repository contains no Cloud product logic, credentials, customer data,
or hosted-service implementation.

## Repeatable copy

From the Radius repository:

```bash
apps/desktop/scripts/sync-dashboard-ui.sh \
  /absolute/path/to/source_frontend
```

The script copies and verifies the complete source global stylesheet,
Tailwind utility stylesheet, and the 18 UI primitives used by the desktop
shell. Copied styles normalize trailing whitespace. UI imports are changed
from the source `@/` alias to Radius's
`@renderer/` alias. Radius deliberately omits the source loading-cube
brand glyph and uses a text-only wordmark. The script applies and verifies two
explicit Radius density adaptations after copying: `PopoverContent` and
`TooltipContent` use a 4px default inset. Product compositions that need more
space declare it at the call site.

The shadcn configuration is `apps/desktop/components.json`. It keeps the source
New York style, Radix base, Lucide icons, Tailwind v4 tokens, and semantic color
system while setting `rsc: false` and Electron renderer aliases.

## Adapted desktop composition

- `components/shell/workspace-shell.tsx` owns the collapsible navigator, sticky
  top navbar, responsive tool-panel rail/popover, keyboard controls, and local
  panel preferences.
- `components/shell/workspace-sidebar.tsx` keeps the source wordmark, navigation,
  sidebar chrome, Connect AI action, and account-settings footer grammar.
- `components/shell/workspace-session-list.tsx` adapts the source
  `research-thread-list.tsx` organization, two-action hover row, and
  reduced-motion-aware 160-180ms layout transitions to Radius projects,
  sessions, local unread state, and the Electron preload boundary.
- `components/shell/workspace-tool-panel.tsx` uses the exact copied panel
  primitive for local runtime, storage, sync, platform, and settings controls.
- `app/workspace/page.tsx` and `app/settings/page.tsx` mirror the web
  application's route-owned page structure without adding Next.js.
- `app/app.tsx` keeps Radius-only route-presence behavior behind a shell-owned
  adapter so the copied Motion facade remains byte-verifiable and safe to sync.
- `app/settings/page.tsx` preserves the existing local sync/provider behavior
  behind the Electron preload boundary and presents it with copied shadcn
  controls.
- `components/ui/segmented-control.tsx` adapts the source dashboard's rounded,
  sliding selection surface to Radius's Vite runtime, motion facade, keyboard
  behavior, and reduced-motion rules.
- `index.css` contains only Electron-specific window sizing and titlebar
  drag/no-drag rules. Product styling comes from the copied source styles.

The renderer remains Electron Vite. It does not import Cloud code or require a
Cloud account; provider connection remains optional and user initiated.
