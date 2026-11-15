import { readFileSync } from "node:fs";

import { buildApplication, buildRouteMap } from "@stricli/core";

import { appRoutes } from "./commands/app/command.js";
import { agentBuildCommand } from "./commands/build/command.js";
import { checkCommand } from "./commands/check/command.js";
import { devCommand } from "./commands/dev/command.js";
import { initCommand } from "./commands/init/command.js";
import { pushCommand } from "./commands/push/command.js";
import type { RadiusContext } from "./context.js";

const routes = buildRouteMap<
  "init" | "dev" | "check" | "build" | "push" | "app",
  RadiusContext
>({
  routes: {
    init: initCommand,
    dev: devCommand,
    check: checkCommand,
    build: agentBuildCommand,
    push: pushCommand,
    app: appRoutes,
  },
  docs: { brief: "Build and run agents on Radius" },
});

// Read from package.json, one level up from both src/ and the bundled dist/,
// so `radius --version` can never disagree with the published version.
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

export const app = buildApplication(routes, {
  name: "radius",
  versionInfo: { currentVersion: version },
});
