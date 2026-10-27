import { buildCommand } from "@stricli/core";

import { commonFlags } from "../../flags.js";

/**
 * Flags and docs only. The handler sits behind `loader:` so `--help` and a
 * malformed invocation never import the registry client, the schema package
 * or the config writer — ADR-008's reason for one directory per command.
 */
export const initCommand = buildCommand({
  loader: async () => import("./run.js"),
  parameters: {
    flags: {
      ...commonFlags,
      harness: {
        kind: "parsed",
        parse: String,
        brief: "ACP registry id to install, e.g. opencode or deepagents",
        optional: true,
      },
      name: {
        kind: "parsed",
        parse: String,
        brief: "Display name for the agent (defaults to the harness name)",
        optional: true,
      },
      yes: {
        kind: "boolean",
        brief: "Never prompt; fail instead if something is missing",
        default: false,
      },
      list: {
        kind: "boolean",
        brief: "List the harness ids the ACP registry offers, and exit",
        default: false,
      },
    },
  },
  docs: {
    brief: "Create or fill in radius.json for an agent in this directory",
    fullDescription:
      "Writes radius.json, minting an agent id and copying the chosen harness's concrete archive URLs and digests out of the ACP registry.\n\nRe-running is safe: present values are never overwritten, only missing ones are added.",
  },
});
