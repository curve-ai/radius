import { buildCommand } from "@stricli/core";

import { commonFlags } from "../../flags.js";

export const devCommand = buildCommand({
  loader: async () => import("./run.js"),
  parameters: {
    flags: {
      ...commonFlags,
      "no-open": {
        kind: "boolean",
        brief: "Do not bring the Radius desktop app up",
        default: false,
      },
      verbose: {
        kind: "boolean",
        brief: "Log every ACP frame as it crosses the bridge",
        default: false,
      },
    },
  },
  docs: {
    brief: "Run this agent's harness and connect it to the Radius desktop app",
    fullDescription:
      "Starts the harness declared in radius.json, speaks ACP to it over stdio, and registers it so a running Radius picks it up.\n\nBrings the Radius desktop app up if it is installed and not already running; the agent is registered either way, so --no-open changes nothing but the convenience.\n\nThe harness is downloaded and checksum-verified on first use, then cached by digest.",
  },
});
