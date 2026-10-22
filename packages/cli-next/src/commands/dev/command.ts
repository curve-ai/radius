import { buildCommand } from "@stricli/core";

import { commonFlags } from "../../flags.js";

export const devCommand = buildCommand({
  loader: async () => import("./run.js"),
  parameters: {
    flags: {
      ...commonFlags,
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
      "Starts the harness declared in radius.json, speaks ACP to it over stdio, and registers it so a running Radius picks it up.\n\nThe harness is downloaded and checksum-verified on first use, then cached by digest.",
  },
});
