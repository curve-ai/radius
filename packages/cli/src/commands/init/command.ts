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
      force: {
        kind: "boolean",
        brief:
          "Re-pin the harness to the newest version Radius supports and rewrite radius.lock",
        default: false,
      },
    },
  },
  docs: {
    brief:
      "Create or fill in radius.json and radius.lock for an agent in this directory",
    fullDescription:
      "Writes radius.json with an agent id and a harness pin (e.g. opencode@1.19.4), and radius.lock with the concrete archive URLs and digests. Commit both. They come from the ACP registry, unless Radius declares a supported range for the harness and the registry's version is outside it: then the newest supported version the CLI carries is pinned instead, and init says so. An opencode project is recognised from opencode.json or .opencode/ without --harness, and its include and toolchains are inferred from the files present. A langgraph.json whose graphs are all Python, or all JavaScript/TypeScript, is set up as a langgraph runtime instead: no harness, no registry and no radius.lock.\n\nRe-running is safe: present values are never overwritten, only missing ones are added. --force re-pins to the newest supported version, and moves a radius.json that pins its harness inline to the short form.",
  },
});
