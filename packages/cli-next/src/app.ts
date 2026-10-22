import { buildApplication, buildRouteMap } from "@stricli/core";

import { devCommand } from "./commands/dev/command.js";
import { initCommand } from "./commands/init/command.js";
import type { RadiusContext } from "./context.js";

const routes = buildRouteMap<"init" | "dev", RadiusContext>({
  routes: { init: initCommand, dev: devCommand },
  docs: { brief: "Build and run agents on Radius" },
});

export const app = buildApplication(routes, {
  name: "radius",
  versionInfo: { currentVersion: "0.0.1" },
});
