import type { SessionConfigOption } from "@curve-ai/radius-runtime";

import {
  PROBE_PROTOCOL_VERSION,
  probeAcp,
  type ProbeFailure,
  type ProbeOptions,
  type ProbeResult,
} from "./acp-probe.js";
import { discoverProjectAgents, type ProjectAgents } from "./project-agents.js";
import { advertisedAgents } from "./handshake.js";

/**
 * What `radius check` concludes, kept apart from how it is printed so the
 * verdicts can be tested without a terminal and emitted as JSON unchanged.
 *
 * It answers two questions, and the second is the one that matters. Every
 * failure this command was written for passes the first: `deepagents-acp`'s
 * stock bin and an opencode that lost the project tree both answer
 * `initialize` and open a session. Only the agents on offer show that the
 * thing on the other end is a stranger.
 */

export type VerdictStatus = "pass" | "fail" | "skip";

export interface Verdict {
  readonly id: "handshake" | "agents" | "stdout";
  readonly status: VerdictStatus;
  readonly summary: string;
  readonly detail: readonly string[];
}

export interface CheckResult {
  readonly passed: boolean;
  readonly command: readonly string[];
  readonly protocolVersion: number | null;
  readonly agentInfo: { name?: string; version?: string } | null;
  readonly advertisedAgents: readonly string[];
  readonly project: ProjectAgents;
  readonly probe: Pick<
    ProbeResult,
    "stage" | "failure" | "stdoutNoise" | "stderrTail" | "elapsedMs"
  >;
  readonly verdicts: readonly Verdict[];
}

/**
 * The agents opencode brings when the project defines none. Seeing only these
 * is the signature of a harness started outside the project tree.
 */
export const OPENCODE_BUILT_IN_AGENTS: ReadonlySet<string> = new Set([
  "build",
  "plan",
  "general",
  "explore",
]);

/**
 * `agentInfo.name` values that only a framework's stock entry point reports.
 *
 * deepagents-acp advertises the same three modes whichever agent it serves,
 * so its mode list proves nothing; the server name is the one thing its
 * generic bin cannot change, because it is the bin's own default.
 */
const GENERIC_AGENT_IDENTITIES: ReadonlyMap<string, string> = new Map([
  [
    "deepagents-acp",
    "The stock deepagents-acp bin never loads project code. Start a script that constructs DeepAgentsServer with your agent, and give it a serverName of its own.",
  ],
]);

const STDERR_LINES_SHOWN = 12;

export async function checkAgent(
  options: Omit<ProbeOptions, "cwd"> & { readonly root: string },
): Promise<CheckResult> {
  const [project, probe] = await Promise.all([
    discoverProjectAgents(options.root),
    probeAcp({ ...options, cwd: options.root }),
  ]);
  return evaluate(options.command, project, probe);
}

export function evaluate(
  command: readonly string[],
  project: ProjectAgents,
  probe: ProbeResult,
): CheckResult {
  const protocolVersion =
    typeof probe.initialize?.protocolVersion === "number"
      ? probe.initialize.protocolVersion
      : null;
  const agentInfo = readAgentInfo(probe.initialize);
  const advertised = probe.session ? advertisedFrom(probe.session) : [];

  const verdicts: Verdict[] = [
    judgeHandshake(probe, protocolVersion, agentInfo),
    probe.session
      ? judgeAgents(project, advertised, agentInfo)
      : {
          id: "agents",
          status: "skip",
          summary: "agents not checked — no session was opened",
          detail: [],
        },
    judgeStdout(probe),
  ];

  return {
    passed: verdicts.every((verdict) => verdict.status !== "fail"),
    command,
    protocolVersion,
    agentInfo,
    advertisedAgents: advertised,
    project,
    probe: {
      stage: probe.stage,
      failure: probe.failure,
      stdoutNoise: probe.stdoutNoise,
      stderrTail: probe.stderrTail,
      elapsedMs: probe.elapsedMs,
    },
    verdicts,
  };
}

function judgeHandshake(
  probe: ProbeResult,
  protocolVersion: number | null,
  agentInfo: CheckResult["agentInfo"],
): Verdict {
  if (probe.failure) {
    return {
      id: "handshake",
      status: "fail",
      summary: describeFailure(probe.failure, probe.stage),
      detail: stderrLines(probe.stderrTail),
    };
  }
  if (protocolVersion === null) {
    return {
      id: "handshake",
      status: "fail",
      summary: "initialize returned no protocolVersion",
      detail: [],
    };
  }
  if (protocolVersion !== PROBE_PROTOCOL_VERSION) {
    // ACP has the agent answer with the version it will speak; one Radius did
    // not ask for means the client must disconnect, so this is not a warning.
    return {
      id: "handshake",
      status: "fail",
      summary: `negotiated ACP v${protocolVersion}, but Radius speaks v${PROBE_PROTOCOL_VERSION}`,
      detail: [],
    };
  }
  const identity = agentInfo?.name
    ? ` — ${agentInfo.name}${agentInfo.version ? ` ${agentInfo.version}` : ""}`
    : "";
  return {
    id: "handshake",
    status: "pass",
    summary: `speaks ACP v${protocolVersion}${identity}`,
    detail: [],
  };
}

function describeFailure(failure: ProbeFailure, stage: string): string {
  switch (failure.kind) {
    case "spawn":
      return `could not start the command: ${failure.message}`;
    case "timeout":
      return `no answer to ${stage} within ${Math.round(failure.afterMs / 1000)}s`;
    case "exit":
      return `exited during ${stage} (${
        failure.signal
          ? `signal ${failure.signal}`
          : `code ${String(failure.code)}`
      })`;
    case "rpc":
      return `${stage} failed: ${failure.message}${
        failure.code === null ? "" : ` (${failure.code})`
      }`;
    case "aborted":
      return `interrupted during ${stage}`;
  }
}

export function judgeAgents(
  project: ProjectAgents,
  advertised: readonly string[],
  agentInfo: CheckResult["agentInfo"],
): Verdict {
  const shown = advertised.length > 0 ? advertised.join(", ") : "none";

  const generic = agentInfo?.name
    ? GENERIC_AGENT_IDENTITIES.get(agentInfo.name)
    : undefined;
  if (generic) {
    return {
      id: "agents",
      status: "fail",
      summary: `serves ${agentInfo!.name}'s generic agent, not yours`,
      detail: [`advertised  ${shown}`, generic],
    };
  }

  switch (project.framework) {
    case "opencode": {
      const detail = [
        `expected    ${project.primary.join(", ") || "none"}  (${project.sources.join(", ")})`,
        `advertised  ${shown}`,
      ];
      if (project.subagents.length > 0) {
        detail.push(
          `subagents   ${project.subagents.join(", ")}  (opencode does not offer these as modes)`,
        );
      }
      if (project.disabled.length > 0) {
        detail.push(`disabled    ${project.disabled.join(", ")}`);
      }
      if (project.primary.length === 0) {
        return {
          id: "agents",
          status: "skip",
          summary:
            "agents not compared — the project defines no primary opencode agent",
          detail,
        };
      }
      const offered = project.primary.filter((name) =>
        advertised.includes(name),
      );
      // A project may customise a built-in — `agent.build` in opencode.json —
      // and that name is advertised either way. Only an agent the harness
      // could not have brought itself proves the project tree was read.
      const distinctive = project.primary.filter(
        (name) => !OPENCODE_BUILT_IN_AGENTS.has(name),
      );
      const strangerOnly =
        distinctive.length > 0 &&
        !distinctive.some((name) => advertised.includes(name));
      if (offered.length === 0 || strangerOnly) {
        const builtInsOnly =
          advertised.length > 0 &&
          advertised.every((name) => OPENCODE_BUILT_IN_AGENTS.has(name));
        return {
          id: "agents",
          status: "fail",
          summary: builtInsOnly
            ? "advertises only opencode's built-in agents, not yours"
            : "advertises none of your agents",
          detail: [
            ...detail,
            "The harness did not read this project's opencode config. Check it starts with the project as its working directory.",
          ],
        };
      }
      const missing = project.primary.filter(
        (name) => !advertised.includes(name),
      );
      if (missing.length > 0) detail.push(`missing     ${missing.join(", ")}`);
      return {
        id: "agents",
        status: "pass",
        summary: "advertises your agents",
        detail,
      };
    }
    case "langgraph": {
      const detail = [
        `expected    ${project.graphs.join(", ") || "none"}  (langgraph.json)`,
        `advertised  ${shown}`,
      ];
      if (project.graphs.some((name) => advertised.includes(name))) {
        return {
          id: "agents",
          status: "pass",
          summary: "advertises your agents",
          detail,
        };
      }
      // Not a failure: a LangGraph server over ACP may well advertise modes
      // rather than graph names, so their absence is not proof of a stranger.
      return {
        id: "agents",
        status: "skip",
        summary:
          "agents not confirmed — none of your graphs are advertised by name",
        detail,
      };
    }
    case "unknown":
      return {
        id: "agents",
        status: "skip",
        summary:
          "agents not compared — no agent definitions found in this project",
        detail: [
          `advertised  ${shown}`,
          "Looked for .opencode/agent(s)/*.md, opencode.json and langgraph.json.",
        ],
      };
  }
}

function judgeStdout(probe: ProbeResult): Verdict {
  if (probe.stdoutNoise.length === 0) {
    return {
      id: "stdout",
      status: "pass",
      summary: "stdout carries only ACP",
      detail: [],
    };
  }
  return {
    id: "stdout",
    status: "fail",
    summary:
      "wrote non-JSON-RPC output to stdout, which corrupts the ACP stream",
    detail: [
      ...probe.stdoutNoise.slice(0, 5).map((line) => `stdout  ${line}`),
      "Send logs to stderr; stdout is the protocol channel.",
    ],
  };
}

function readAgentInfo(
  initialize: Record<string, unknown> | null,
): CheckResult["agentInfo"] {
  const raw = initialize?.agentInfo;
  if (!raw || typeof raw !== "object") return null;
  const { name, version } = raw as Record<string, unknown>;
  return {
    ...(typeof name === "string" ? { name } : {}),
    ...(typeof version === "string" ? { version } : {}),
  };
}

/**
 * The same extraction `build` uses, so `check` and a verified image can never
 * disagree about what an agent advertised. The probe's input is an untrusted
 * wire response rather than a parsed session, so it is narrowed first:
 * extraction assumes the shapes the SDK has already validated.
 */
function advertisedFrom(session: Record<string, unknown>): string[] {
  const modes = isRecord(session.modes) ? session.modes : null;
  const availableModes = Array.isArray(modes?.availableModes)
    ? modes.availableModes.filter(isRecord)
    : [];
  const configOptions = Array.isArray(session.configOptions)
    ? session.configOptions.filter(isWellFormedOption)
    : [];
  return advertisedAgents({
    sessionModes: { availableModes },
    sessionConfigOptions: configOptions as SessionConfigOption[],
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWellFormedOption(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type !== "select") return true;
  if (!Array.isArray(value.options)) return false;
  return value.options.every(
    (entry) =>
      isRecord(entry) &&
      (Array.isArray(entry.options)
        ? entry.options.every(
            (leaf) => isRecord(leaf) && typeof leaf.value === "string",
          )
        : typeof entry.value === "string"),
  );
}

function stderrLines(tail: string): string[] {
  const lines = tail.trimEnd().split(/\r?\n/).filter(Boolean);
  return lines.slice(-STDERR_LINES_SHOWN).map((line) => `stderr  ${line}`);
}
