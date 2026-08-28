import assert from "node:assert/strict";
import test from "node:test";

import {
  agentPlanJournalEvents,
  createAgentPlanJournalState,
} from "./agent-plan-events";

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++]!;
}

test("creates a canonical plan and only records meaningful initial states", () => {
  const state = createAgentPlanJournalState();
  const events = agentPlanJournalEvents(
    state,
    {
      sessionUpdate: "plan",
      entries: [
        {
          content: "Inspect the current UI",
          priority: "high",
          status: "completed",
        },
        {
          content: "Build plan progress",
          priority: "high",
          status: "in_progress",
        },
        { content: "Verify the result", priority: "medium", status: "pending" },
      ],
    },
    ids(
      "plan",
      "step-1",
      "step-2",
      "step-3",
      "plan-event",
      "update-1",
      "update-2",
    ),
  );

  assert.deepEqual(events, [
    {
      eventId: "plan-event",
      eventType: "task_plan",
      planId: "plan",
      title: "Plan",
      supersedesPlanId: null,
      steps: [
        { id: "step-1", position: 0, title: "Inspect the current UI" },
        { id: "step-2", position: 1, title: "Build plan progress" },
        { id: "step-3", position: 2, title: "Verify the result" },
      ],
    },
    {
      eventId: "update-1",
      eventType: "task_step_update",
      taskStepId: "step-1",
      state: "completed",
      detail: null,
    },
    {
      eventId: "update-2",
      eventType: "task_step_update",
      taskStepId: "step-2",
      state: "in_progress",
      detail: null,
    },
  ]);
});

test("updates unchanged steps and supersedes a structurally revised plan", () => {
  const state = createAgentPlanJournalState();
  agentPlanJournalEvents(
    state,
    {
      sessionUpdate: "plan",
      entries: [
        { content: "Inspect", priority: "high", status: "in_progress" },
        { content: "Verify", priority: "medium", status: "pending" },
      ],
    },
    ids("plan-1", "step-1", "step-2", "plan-event", "started"),
  );

  assert.deepEqual(
    agentPlanJournalEvents(
      state,
      {
        sessionUpdate: "plan",
        entries: [
          { content: "Inspect", priority: "high", status: "completed" },
          { content: "Verify", priority: "medium", status: "in_progress" },
        ],
      },
      ids("complete-1", "start-2"),
    ),
    [
      {
        eventId: "complete-1",
        eventType: "task_step_update",
        taskStepId: "step-1",
        state: "completed",
        detail: null,
      },
      {
        eventId: "start-2",
        eventType: "task_step_update",
        taskStepId: "step-2",
        state: "in_progress",
        detail: null,
      },
    ],
  );

  const revised = agentPlanJournalEvents(
    state,
    {
      sessionUpdate: "plan",
      entries: [
        { content: "Inspect", priority: "high", status: "completed" },
        { content: "Polish", priority: "medium", status: "pending" },
      ],
    },
    ids("plan-2", "step-3", "step-4", "revised-event", "complete-3"),
  );
  assert.equal(revised[0]?.eventType, "task_plan");
  if (revised[0]?.eventType !== "task_plan") return;
  assert.equal(revised[0].supersedesPlanId, "plan-1");
});
