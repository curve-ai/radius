import type { SessionUpdate } from "@curve-ai/radius-runtime";

type ConfigOptionUpdate = Extract<
  SessionUpdate,
  { sessionUpdate: "config_option_update" }
>;
type AvailableCommandsUpdate = Extract<
  SessionUpdate,
  { sessionUpdate: "available_commands_update" }
>;
type UsageUpdate = Extract<SessionUpdate, { sessionUpdate: "usage_update" }>;

export type AgentSessionConfigOption =
  ConfigOptionUpdate["configOptions"][number];
export type AgentAvailableCommand =
  AvailableCommandsUpdate["availableCommands"][number];
export type AgentSessionUsage = Omit<UsageUpdate, "sessionUpdate">;

export interface AgentSessionMode {
  id: string;
  name: string;
  description?: string | null;
  _meta?: Record<string, unknown> | null;
}

export interface AgentSessionModeState {
  currentModeId: string;
  availableModes: AgentSessionMode[];
}

export interface AgentSessionFeatureState {
  availableCommands: AgentAvailableCommand[];
  configOptions: AgentSessionConfigOption[];
  modes: AgentSessionModeState | null;
  usage: AgentSessionUsage | null;
}

export interface AgentSessionFeatureOwner {
  agentId: string;
  providerKey: string;
  state: AgentSessionFeatureState;
}

export interface AgentSessionFeatureInitialState {
  availableCommands?: readonly AgentAvailableCommand[] | null;
  configOptions?: readonly AgentSessionConfigOption[] | null;
  modes?: {
    currentModeId: string;
    availableModes: readonly AgentSessionMode[];
  } | null;
  usage?: AgentSessionUsage | null;
}

export type AgentSessionConfigSelection =
  | { configId: string; type: "select"; value: string }
  | { configId: string; type: "boolean"; value: boolean };

export interface AgentSessionModeSelection {
  modeId: string;
}

/**
 * Capabilities Radius must advertise before accepting boolean config options or
 * the ID-addressed experimental plan updates introduced in ACP SDK 1.4.
 */
export const AGENT_SESSION_FEATURE_CLIENT_CAPABILITIES = {
  session: { configOptions: { boolean: {} } },
  plan: {},
} as const;

export function createAgentSessionFeatureState(
  initial: AgentSessionFeatureInitialState = {},
): AgentSessionFeatureState {
  return {
    availableCommands: [...(initial.availableCommands ?? [])],
    configOptions: [...(initial.configOptions ?? [])],
    modes: initial.modes
      ? {
          currentModeId: initial.modes.currentModeId,
          availableModes: [...initial.modes.availableModes],
        }
      : null,
    usage: initial.usage ? { ...initial.usage } : null,
  };
}

export function resolveAgentSessionFeatureOwner(
  current: AgentSessionFeatureOwner | undefined,
  agentId: string,
  providerKey: string,
): AgentSessionFeatureOwner {
  return current?.providerKey === providerKey
    ? current
    : { agentId, providerKey, state: createAgentSessionFeatureState() };
}

export function agentSessionFeatureOverrideKey(
  sessionId: string,
  providerKey: string,
): string {
  return `${sessionId}\0${providerKey}`;
}

/**
 * Applies the ACP session feature updates consumed by the composer. Arrays stay
 * in agent-provided order and unknown configuration categories remain intact.
 */
export function applyAgentSessionFeatureUpdate(
  state: AgentSessionFeatureState,
  update: SessionUpdate,
): void {
  switch (update.sessionUpdate) {
    case "available_commands_update": {
      state.availableCommands = [...update.availableCommands];
      return;
    }
    case "config_option_update": {
      state.configOptions = [...update.configOptions];
      return;
    }
    case "current_mode_update": {
      if (state.modes) state.modes.currentModeId = update.currentModeId;
      return;
    }
    case "usage_update": {
      state.usage = stripSessionUpdate(update);
      return;
    }
    default:
      return;
  }
}

/**
 * Resolves a UI value to a typed ACP set-config-option selection only when the
 * agent currently advertises that option and value.
 */
export function resolveAgentSessionConfigSelection(
  configOptions: readonly AgentSessionConfigOption[],
  configId: string,
  value: string | boolean,
): AgentSessionConfigSelection | null {
  const option = configOptions.find((entry) => entry.id === configId);
  if (!option) return null;

  if (option.type === "boolean") {
    return typeof value === "boolean"
      ? { configId, type: "boolean", value }
      : null;
  }
  if (typeof value !== "string") return null;

  const advertised = option.options.some((entry) =>
    "options" in entry
      ? entry.options.some((nested) => nested.value === value)
      : entry.value === value,
  );
  return advertised ? { configId, type: "select", value } : null;
}

export function resolveAgentSessionModeSelection(
  modes: AgentSessionModeState | null,
  modeId: string,
): AgentSessionModeSelection | null {
  return modes?.availableModes.some((mode) => mode.id === modeId)
    ? { modeId }
    : null;
}

function stripSessionUpdate(update: UsageUpdate): AgentSessionUsage {
  const usage: Partial<UsageUpdate> = { ...update };
  delete usage.sessionUpdate;
  return usage as AgentSessionUsage;
}
