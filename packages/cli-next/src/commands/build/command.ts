import { buildCommand } from "@stricli/core";

import { commonFlags } from "../../flags.js";

export const agentBuildCommand = buildCommand({
  loader: async () => import("./run.js"),
  parameters: {
    flags: {
      ...commonFlags,
      "skip-verify": {
        kind: "boolean",
        brief: "Produce the layout without booting it in a microVM",
        default: false,
      },
      config: {
        kind: "parsed",
        parse: String,
        brief: "Path to the agent config, if it is not radius.json",
        optional: true,
      },
    },
  },
  docs: {
    brief: "Package this agent into an immutable image a Radius app can import",
    fullDescription:
      "Builds a linux/arm64 OCI layout from radius.json, records a receipt under .radius/builds/, and by default boots the result in a microVM to check it answers ACP (--skip-verify to stop at the layout).\n\nWorks for every runtime kind: a TypeScript or Python agent is compiled from its entrypoint, and a harness agent ships the pinned harness plus the project tree declared in runtime.include.",
  },
});
