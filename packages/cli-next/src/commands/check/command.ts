import { buildCommand } from "@stricli/core";

import { commonFlags } from "../../flags.js";

function parseSeconds(value: string): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new SyntaxError(
      `expected a positive number of seconds, got ${value}`,
    );
  }
  return seconds;
}

export const checkCommand = buildCommand({
  loader: async () => import("./run.js"),
  parameters: {
    flags: {
      ...commonFlags,
      verbose: {
        kind: "boolean",
        brief: "Log every ACP frame and the agent's stderr",
        default: false,
      },
      timeout: {
        kind: "parsed",
        parse: parseSeconds,
        brief: "Seconds to wait for the handshake to complete",
        // Generous because the first `npx` run installs the package before
        // the agent can answer anything.
        default: "60",
      },
    },
  },
  docs: {
    brief: "Check this agent speaks ACP and serves your own agents",
    fullDescription:
      "Starts the command radius.json declares, sends ACP initialize and session/new over stdio, and stops before any prompt, so no provider key is needed.\n\nPasses only if the handshake completes, stdout carries nothing but JSON-RPC, and the agents advertised are the ones this project defines — read from .opencode/agent(s)/*.md and opencode.json, or the graphs in langgraph.json. A harness that answers but serves its own defaults fails.",
  },
});
