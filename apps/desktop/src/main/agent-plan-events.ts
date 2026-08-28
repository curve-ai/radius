import { randomUUID } from "node:crypto";

import type { SessionUpdate } from "@curve-ai/radius-runtime";

type AcpPlanUpdate = Extract<SessionUpdate, { sessionUpdate: "plan" }>;
type PlanStepState = AcpPlanUpdate["entries"][number]["status"];

export type AgentPlanJournalEvent =
  | {
      eventId: string;
      eventType: "task_plan";
      planId: string;
      title: string;
      supersedesPlanId: string | null;
      steps: Array<{ id: string; position: number; title: string }>;
    }
  | {
      eventId: string;
      eventType: "task_step_update";
      taskStepId: string;
      state: PlanStepState;
      detail: null;
    };

interface CurrentAgentPlan {
  id: string;
  contents: string[];
  statuses: PlanStepState[];
  stepIds: string[];
}

export interface AgentPlanJournalState {
  current: CurrentAgentPlan | null;
}

export function createAgentPlanJournalState(): AgentPlanJournalState {
  return { current: null };
}

export function agentPlanJournalEvents(
  state: AgentPlanJournalState,
  update: AcpPlanUpdate,
  createId: () => string = randomUUID,
): AgentPlanJournalEvent[] {
  const entries = update.entries.flatMap((entry) => {
    const content = entry.content.trim();
    return content ? [{ content, status: entry.status }] : [];
  });
  if (entries.length === 0) return [];

  const contents = entries.map((entry) => entry.content);
  const statuses = entries.map((entry) => entry.status);
  const current = state.current;
  const samePlan =
    current?.contents.length === contents.length &&
    current.contents.every((content, index) => content === contents[index]);

  if (current && samePlan) {
    const events = entries.flatMap<AgentPlanJournalEvent>((entry, index) => {
      if (current.statuses[index] === entry.status) return [];
      return [
        {
          eventId: createId(),
          eventType: "task_step_update",
          taskStepId: current.stepIds[index]!,
          state: entry.status,
          detail: null,
        },
      ];
    });
    current.statuses = statuses;
    return events;
  }

  const previousPlanId = state.current?.id ?? null;
  const planId = createId();
  const stepIds = entries.map(() => createId());
  state.current = { id: planId, contents, statuses, stepIds };

  return [
    {
      eventId: createId(),
      eventType: "task_plan",
      planId,
      title: "Plan",
      supersedesPlanId: previousPlanId,
      steps: entries.map((entry, index) => ({
        id: stepIds[index]!,
        position: index,
        title: entry.content,
      })),
    },
    ...entries.flatMap<AgentPlanJournalEvent>((entry, index) =>
      entry.status === "pending"
        ? []
        : [
            {
              eventId: createId(),
              eventType: "task_step_update",
              taskStepId: stepIds[index]!,
              state: entry.status,
              detail: null,
            },
          ],
    ),
  ];
}
