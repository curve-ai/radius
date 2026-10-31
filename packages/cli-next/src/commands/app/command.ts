import { buildCommand, buildRouteMap } from "@stricli/core";

import type { RadiusContext } from "../../context.js";
import { commonFlags } from "../../flags.js";

/**
 * Flags and docs only; the handlers sit behind `loader:` like every other
 * command, so `--help` never imports the installer.
 */
const installFlags = {
  ...commonFlags,
  yes: {
    kind: "boolean",
    brief: "Never prompt",
    default: false,
  },
} as const;

export const appInstallCommand = buildCommand({
  loader: async () => (await import("./run.js")).install,
  parameters: { flags: installFlags },
  docs: {
    brief: "Install the Radius desktop app, if it is missing or older",
    fullDescription:
      "Downloads the desktop release this CLI pins, checks its size and SHA-256 before unpacking, and installs it to ~/Applications/Radius.app (or updates an existing /Applications copy it can write to). Never downgrades, and refuses while Radius is running. macOS on Apple Silicon only for now; RADIUS_APP_PATH sets where it installs.",
  },
});

export const appUpdateCommand = buildCommand({
  loader: async () => (await import("./run.js")).update,
  parameters: { flags: installFlags },
  docs: {
    brief: "Update the Radius desktop app to the release this CLI pins",
    fullDescription:
      "The same as `radius app install`, said from the other side: reports when the app is already up to date. Quit Radius first.",
  },
});

export const appPathCommand = buildCommand({
  loader: async () => (await import("./run.js")).path,
  parameters: { flags: { ...commonFlags } },
  docs: {
    brief:
      "Print where the Radius desktop app is installed; exit 1 if it is not",
  },
});

export const appOpenCommand = buildCommand({
  loader: async () => (await import("./run.js")).open,
  parameters: { flags: { ...commonFlags } },
  docs: { brief: "Open the Radius desktop app" },
});

export const appRoutes = buildRouteMap<
  "install" | "update" | "path" | "open",
  RadiusContext
>({
  routes: {
    install: appInstallCommand,
    update: appUpdateCommand,
    path: appPathCommand,
    open: appOpenCommand,
  },
  docs: { brief: "Install, update and open the Radius desktop app" },
});
