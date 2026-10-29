import { buildApplication, buildRouteMap } from "@stricli/core";

import { agentBuildCommand } from "./commands/build/command.js";
import { checkCommand } from "./commands/check/command.js";
import { devCommand } from "./commands/dev/command.js";
import { initCommand } from "./commands/init/command.js";
import type { RadiusContext } from "./context.js";

const routes = buildRouteMap<"init" | "dev" | "check" | "build", RadiusContext>(
  {
    routes: {
      init: initCommand,
      dev: devCommand,
      check: checkCommand,
      build: agentBuildCommand,
    },
    docs: { brief: "Build and run agents on Radius" },
  },
);

export const app = buildApplication(routes, {
  name: "radius",
  versionInfo: { currentVersion: "0.0.1" },
});
