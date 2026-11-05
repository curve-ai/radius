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
      yes: {
        kind: "boolean",
        brief: "Never prompt; install or update the Radius app without asking",
        default: false,
      },
      verbose: {
        kind: "boolean",
        brief:
          "Also print the endpoint, descriptor and command, and log every ACP frame",
        default: false,
      },
    },
  },
  docs: {
    brief: "Serve this agent to the Radius desktop app, one process per thread",
    fullDescription:
      "Checks the agent declared in radius.json starts and speaks ACP, then registers it so a running Radius picks it up. Every thread the desktop opens gets its own process over stdio; one crashing ends only that thread. Runs harness, typescript, python and command runtimes.\n\nOpens the Radius desktop app on this agent. If the app is missing it offers to download it (--yes installs without asking), and if it is older than the release this CLI pins it offers to update it while it is not running. The agent is registered either way, so --no-open, which skips all of that, changes nothing but the convenience.\n\nThe harness is downloaded and checksum-verified on first use, then cached by digest.",
  },
});
