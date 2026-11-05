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
      platform: {
        kind: "parsed",
        parse: String,
        brief:
          "Linux images to build: linux/arm64, linux/amd64 or all, comma-separated (default: this machine's)",
        optional: true,
      },
    },
  },
  docs: {
    brief: "Package this agent into an immutable image a Radius app can import",
    fullDescription:
      "Builds a Linux OCI layout from radius.json, records a receipt under .radius/builds/, and by default boots the result in a microVM to check it answers ACP (--skip-verify to stop at the layout).\n\nEvery Radius app runs agents as Linux in a microVM: Apple Silicon Macs need linux/arm64 and Windows x64 needs linux/amd64. The default builds this machine's own; --platform all builds both, each as its own importable layout and receipt. Only this machine's own architecture can be booted, so the other is recorded as built but not verified. Building the other architecture runs its steps under Docker's emulation, which Docker Desktop provides.\n\nA TypeScript or Python agent is compiled from its entrypoint, and a harness agent ships the pinned harness plus the project tree declared in runtime.include. A langgraph runtime cannot be packaged yet; radius dev and radius check run it.",
  },
});
