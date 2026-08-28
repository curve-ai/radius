import type { SessionTranscriptEvent } from "../../../../radius-api";

type MessageEvent = Extract<SessionTranscriptEvent, { eventType: "message" }>;
type RunStateEvent = Extract<
  SessionTranscriptEvent,
  { eventType: "agent_run_state_update" }
>;

export type SessionPlanStepState = Extract<
  SessionTranscriptEvent,
  { eventType: "task_step_update" }
>["state"];
export type SessionRunState = RunStateEvent["state"];

export interface SessionPlanStep {
  id: string;
  position: number;
  title: string;
  state: SessionPlanStepState;
  detail: string | null;
}

export interface SessionPlan {
  eventId: string;
  sessionRevision: number;
  agentRunId: string | null;
  planId: string;
  title: string;
  steps: SessionPlanStep[];
  completed: boolean;
}

export interface SessionPlanPresentation {
  activePlan: SessionPlan | null;
  completedPlanByMessageEventId: ReadonlyMap<string, SessionPlan>;
}

export function formatSessionPlanProgress(plan: SessionPlan): string {
  if (plan.completed) return "Plan completed";
  const currentIndex = plan.steps.findIndex(
    (step) => step.state === "in_progress",
  );
  const nextIndex = plan.steps.findIndex(
    (step) => step.state !== "completed" && step.state !== "skipped",
  );
  const index = currentIndex >= 0 ? currentIndex : Math.max(0, nextIndex);
  return `Step ${index + 1} / ${plan.steps.length}`;
}

export type SessionTranscriptBlock =
  | {
      kind: "message";
      event: Extract<SessionTranscriptEvent, { eventType: "message" }>;
    }
  | {
      kind: "run";
      runId: string;
      events: SessionTranscriptEvent[];
    };

function isStandaloneMessage(
  event: SessionTranscriptEvent,
): event is Extract<SessionTranscriptEvent, { eventType: "message" }> {
  return (
    event.eventType === "message" &&
    (event.agentRunId === null ||
      event.messageKind === "final" ||
      event.messageKind === "run_summary" ||
      event.messageKind === "system_notice")
  );
}

export function buildSessionTranscriptBlocks(
  events: readonly SessionTranscriptEvent[],
): SessionTranscriptBlock[] {
  const blocks: SessionTranscriptBlock[] = [];
  const runBlocks = new Map<
    string,
    Extract<SessionTranscriptBlock, { kind: "run" }>
  >();

  for (const event of events) {
    if (isStandaloneMessage(event)) {
      blocks.push({ kind: "message", event });
      continue;
    }

    if (event.agentRunId) {
      let block = runBlocks.get(event.agentRunId);
      if (!block) {
        block = { kind: "run", runId: event.agentRunId, events: [] };
        runBlocks.set(event.agentRunId, block);
        blocks.push(block);
      }
      block.events.push(event);
    }
  }

  return blocks;
}

const terminalRunStates = new Set<SessionRunState>([
  "completed",
  "failed",
  "cancelled",
]);

export function isTerminalRunState(state: SessionRunState): boolean {
  return terminalRunStates.has(state);
}

export function buildSessionPlanPresentation(
  events: readonly SessionTranscriptEvent[],
): SessionPlanPresentation {
  const plans = new Map<string, SessionPlan>();
  const stepById = new Map<string, SessionPlanStep>();
  const supersededPlanIds = new Set<string>();
  const latestRunState = new Map<string, SessionRunState>();
  const latestPresentation = new Map<
    string,
    Extract<SessionTranscriptEvent, { eventType: "agent_run_presentation" }>
  >();
  const assistantMessageById = new Map<string, MessageEvent>();
  const lastAssistantMessageByRun = new Map<string | null, MessageEvent>();
  const lastSummaryMessageByRun = new Map<string | null, MessageEvent>();
  const lastFinalMessageByRun = new Map<string | null, MessageEvent>();

  for (const event of events) {
    if (event.eventType === "message" && event.role === "assistant") {
      assistantMessageById.set(event.eventId, event);
      lastAssistantMessageByRun.set(null, event);
      if (event.agentRunId) {
        lastAssistantMessageByRun.set(event.agentRunId, event);
      }
      if (event.messageKind === "run_summary") {
        lastSummaryMessageByRun.set(null, event);
        if (event.agentRunId)
          lastSummaryMessageByRun.set(event.agentRunId, event);
      }
      if (event.messageKind === "final") {
        lastFinalMessageByRun.set(null, event);
        if (event.agentRunId)
          lastFinalMessageByRun.set(event.agentRunId, event);
      }
      continue;
    }
    if (event.eventType === "agent_run_state_update") {
      latestRunState.set(event.agentRunId, event.state);
      continue;
    }
    if (event.eventType === "agent_run_presentation") {
      latestPresentation.set(event.agentRunId, event);
      continue;
    }
    if (event.eventType === "task_plan") {
      if (event.supersedesPlanId) supersededPlanIds.add(event.supersedesPlanId);
      const plan: SessionPlan = {
        eventId: event.eventId,
        sessionRevision: event.sessionRevision,
        agentRunId: event.agentRunId,
        planId: event.planId,
        title: event.title,
        steps: event.steps
          .map((step) => ({
            ...step,
            state: "pending" as const,
            detail: null,
          }))
          .sort((left, right) => left.position - right.position),
        completed: false,
      };
      plans.set(plan.planId, plan);
      for (const step of plan.steps) stepById.set(step.id, step);
      continue;
    }
    if (event.eventType === "task_step_update") {
      const step = stepById.get(event.taskStepId);
      if (!step) continue;
      step.state = event.state;
      step.detail = event.detail;
    }
  }

  const currentPlans = Array.from(plans.values())
    .filter((plan) => !supersededPlanIds.has(plan.planId))
    .map<SessionPlan>((plan) => ({
      ...plan,
      completed:
        plan.steps.length > 0 &&
        plan.steps.every(
          (step) => step.state === "completed" || step.state === "skipped",
        ),
    }));
  const latestPlanByRun = new Map<string, SessionPlan>();
  for (const plan of currentPlans) {
    const key = plan.agentRunId ?? plan.planId;
    const current = latestPlanByRun.get(key);
    if (!current || current.sessionRevision < plan.sessionRevision) {
      latestPlanByRun.set(key, plan);
    }
  }
  const latestPlans = Array.from(latestPlanByRun.values());
  let activePlan: SessionPlan | null = null;
  for (const plan of latestPlans) {
    if (plan.completed) continue;
    const runState = plan.agentRunId
      ? latestRunState.get(plan.agentRunId)
      : null;
    const active = runState
      ? !isTerminalRunState(runState)
      : plan.steps.some((step) => step.state === "in_progress");
    if (
      active &&
      (!activePlan || activePlan.sessionRevision < plan.sessionRevision)
    ) {
      activePlan = plan;
    }
  }

  const completedPlanByMessageEventId = new Map<string, SessionPlan>();
  for (const plan of latestPlans) {
    if (!plan.completed) continue;
    const presentation = plan.agentRunId
      ? latestPresentation.get(plan.agentRunId)
      : null;
    const explicitMessage = presentation?.summaryMessageEventId
      ? assistantMessageById.get(presentation.summaryMessageEventId)
      : null;
    const explicitSummary =
      explicitMessage &&
      (plan.agentRunId === null ||
        explicitMessage.agentRunId === plan.agentRunId)
        ? explicitMessage
        : null;
    const target =
      explicitSummary ??
      lastSummaryMessageByRun.get(plan.agentRunId) ??
      lastFinalMessageByRun.get(plan.agentRunId) ??
      lastAssistantMessageByRun.get(plan.agentRunId);
    if (target) completedPlanByMessageEventId.set(target.eventId, plan);
  }

  return { activePlan, completedPlanByMessageEventId };
}
