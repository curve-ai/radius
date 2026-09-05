import type { SessionUpdate } from "@curve-ai/radius-runtime";

type StablePlanUpdate = Extract<SessionUpdate, { sessionUpdate: "plan" }>;
type ExperimentalPlanUpdate = Extract<
  SessionUpdate,
  { sessionUpdate: "plan_update" }
>;
type PlanEntry = StablePlanUpdate["entries"][number];
type ExperimentalPlan = ExperimentalPlanUpdate["plan"];

interface StoredExperimentalPlan {
  plan: ExperimentalPlan;
  sequence: number;
}

const MAX_EXPERIMENTAL_PLANS = 32;

export interface AgentPlanProjectionState {
  canonicalSource: "stable" | `experimental:${string}` | null;
  experimental: Map<string, StoredExperimentalPlan>;
  nextSequence: number;
  stableEntries: PlanEntry[];
}

export interface AgentPlanProjectionChange {
  canonicalEntries: PlanEntry[] | null | undefined;
}

export function createAgentPlanProjectionState(): AgentPlanProjectionState {
  return {
    canonicalSource: null,
    experimental: new Map(),
    nextSequence: 1,
    stableEntries: [],
  };
}

export function applyAgentPlanProjectionUpdate(
  state: AgentPlanProjectionState,
  update: SessionUpdate,
): AgentPlanProjectionChange | null {
  if (update.sessionUpdate === "plan") {
    state.stableEntries = nonEmptyEntries(update.entries);
    return selectCanonicalPlan(state, "stable");
  }

  if (update.sessionUpdate === "plan_update") {
    const previous = state.experimental.get(update.plan.planId);
    if (!previous && state.experimental.size >= MAX_EXPERIMENTAL_PLANS) {
      return { canonicalEntries: undefined };
    }
    state.experimental.set(update.plan.planId, {
      plan: cloneExperimentalPlan(update.plan),
      sequence: state.nextSequence++,
    });
    if (
      update.plan.type === "items" &&
      nonEmptyEntries(update.plan.entries).length > 0
    ) {
      return selectCanonicalPlan(state, `experimental:${update.plan.planId}`);
    }
    return previous?.plan.type === "items" &&
      state.canonicalSource === `experimental:${update.plan.planId}`
      ? selectCanonicalPlan(state)
      : { canonicalEntries: undefined };
  }

  if (update.sessionUpdate === "plan_removed") {
    const removed = state.experimental.delete(update.planId);
    if (!removed) return { canonicalEntries: undefined };
    return state.canonicalSource === `experimental:${update.planId}`
      ? selectCanonicalPlan(state)
      : { canonicalEntries: undefined };
  }

  return null;
}

export function agentPlanReasoningSummaries(
  state: AgentPlanProjectionState,
): string[] {
  return [...state.experimental.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .flatMap(({ plan }) => {
      if (plan.type === "markdown") {
        return [plan.content.trim() || "Agent shared an empty plan."];
      }
      return plan.type === "file" ? ["Agent shared a file-backed plan."] : [];
    });
}

function selectCanonicalPlan(
  state: AgentPlanProjectionState,
  preferredSource?: AgentPlanProjectionState["canonicalSource"],
): AgentPlanProjectionChange {
  const preferred = preferredSource
    ? entriesForSource(state, preferredSource)
    : null;
  if (preferred && preferred.length > 0) {
    state.canonicalSource = preferredSource ?? null;
    return { canonicalEntries: preferred };
  }

  const fallback = [...state.experimental.entries()]
    .filter(([, entry]) => entry.plan.type === "items")
    .sort((left, right) => right[1].sequence - left[1].sequence)
    .find(([, entry]) =>
      entry.plan.type === "items"
        ? nonEmptyEntries(entry.plan.entries).length > 0
        : false,
    );
  if (fallback?.[1].plan.type === "items") {
    state.canonicalSource = `experimental:${fallback[0]}`;
    return { canonicalEntries: nonEmptyEntries(fallback[1].plan.entries) };
  }
  if (state.stableEntries.length > 0) {
    state.canonicalSource = "stable";
    return { canonicalEntries: [...state.stableEntries] };
  }
  state.canonicalSource = null;
  return { canonicalEntries: null };
}

function entriesForSource(
  state: AgentPlanProjectionState,
  source: NonNullable<AgentPlanProjectionState["canonicalSource"]>,
): PlanEntry[] | null {
  if (source === "stable") return [...state.stableEntries];
  const stored = state.experimental.get(source.slice("experimental:".length));
  return stored?.plan.type === "items"
    ? nonEmptyEntries(stored.plan.entries)
    : null;
}

function nonEmptyEntries(entries: readonly PlanEntry[]): PlanEntry[] {
  return entries
    .filter((entry) => entry.content.trim())
    .map((entry) => ({ ...entry }));
}

function cloneExperimentalPlan(plan: ExperimentalPlan): ExperimentalPlan {
  return plan.type === "items"
    ? { ...plan, entries: plan.entries.map((entry) => ({ ...entry })) }
    : { ...plan };
}
