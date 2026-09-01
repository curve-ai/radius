# Desktop update states

> Status: Implemented
> Scope: Packaged Radius desktop clients

This document defines how desktop update status appears in the workspace
sidebar footer. The account/settings row remains the navigation target; the
update affordance is a separate trailing action.

## State presentation

| Updater state                              | Sidebar treatment                                                      | Interaction                                         |
| ------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------- |
| `available`                                | 16px circular brand action with a download icon                        | Starts the download                                 |
| `downloading`                              | Compact brand pill showing the normalized integer percentage           | Disabled while download progress is active          |
| `downloaded`                               | Restart icon in a persistent 32px rounded `--sidebar-accent` highlight | Restarts Radius and installs the update             |
| `unsupported`, `idle`, `checking`, `error` | No sidebar update affordance                                           | Full status and recovery actions remain in Settings |

## Invariants

- Render these states only from the typed desktop updater contract. Do not
  estimate progress in the renderer.
- Keep the visible percentage tabular and expose the version and progress in
  the accessible label.
- Keep the update action separate from account/settings navigation, including
  its click target and keyboard behavior.
- Use the existing brand and sidebar semantic tokens in both themes. Do not add
  a second update-specific color.
- The Settings About surface remains the complete status surface for checking,
  unsupported builds, failures, retry, and installed-version details.

## Implementation references

- `apps/desktop/src/update-types.ts`
- `apps/desktop/src/main/updater.ts`
- `apps/desktop/src/renderer/src/components/shell/desktop-update-action.tsx`
- `apps/desktop/src/renderer/src/app/settings/about-updates.tsx`
