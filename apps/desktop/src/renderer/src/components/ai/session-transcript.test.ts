import assert from "node:assert/strict";
import test from "node:test";

import type { SessionTranscriptEvent } from "../../../../radius-api";
import {
  buildSessionPlanPresentation,
  buildSessionTranscriptBlocks,
  formatSessionPlanProgress,
  type SessionPlan,
} from "./session-transcript";

const base = {
  sessionRevision: 2,
  occurredAt: "2026-08-24T12:00:00.000Z",
};

test("keeps run activity together and places the final answer after it", () => {
  const events: SessionTranscriptEvent[] = [
    {
      ...base,
      eventId: "prompt",
      agentRunId: null,
      eventType: "message",
      role: "user",
      messageKind: "prompt",
      status: "completed",
      text: "Set up messaging UI",
    },
    {
      ...base,
      eventId: "run",
      agentRunId: "run-1",
      eventType: "agent_run",
      providerKey: "codex",
    },
    {
      ...base,
      eventId: "reasoning",
      agentRunId: "run-1",
      eventType: "reasoning_summary",
      summaryKind: "analysis",
      summaryText: "Mapped the existing session surface.",
    },
    {
      ...base,
      eventId: "final",
      agentRunId: "run-1",
      eventType: "message",
      role: "assistant",
      messageKind: "final",
      status: "completed",
      text: "The session UI is ready.",
    },
  ];

  assert.deepEqual(buildSessionTranscriptBlocks(events), [
    { kind: "message", event: events[0] },
    { kind: "run", runId: "run-1", events: [events[1], events[2]] },
    { kind: "message", event: events[3] },
  ]);
});

test("derives the active plan from canonical steps and their latest states", () => {
  const events: SessionTranscriptEvent[] = [
    {
      ...base,
      eventId: "run",
      agentRunId: "run-1",
      eventType: "agent_run",
      providerKey: "fx",
    },
    {
      ...base,
      eventId: "working",
      agentRunId: "run-1",
      eventType: "agent_run_state_update",
      state: "working",
      detail: null,
    },
    {
      ...base,
      eventId: "plan",
      agentRunId: "run-1",
      eventType: "task_plan",
      planId: "plan-1",
      title: "Plan",
      supersedesPlanId: null,
      steps: [
        { id: "step-1", position: 0, title: "Inspect the surface" },
        { id: "step-2", position: 1, title: "Build plan progress" },
      ],
    },
    {
      ...base,
      eventId: "complete-step-1",
      agentRunId: "run-1",
      eventType: "task_step_update",
      taskStepId: "step-1",
      state: "completed",
      detail: null,
    },
    {
      ...base,
      eventId: "start-step-2",
      agentRunId: "run-1",
      eventType: "task_step_update",
      taskStepId: "step-2",
      state: "in_progress",
      detail: null,
    },
  ];

  const presentation = buildSessionPlanPresentation(events);
  assert.equal(presentation.activePlan?.planId, "plan-1");
  assert.deepEqual(
    presentation.activePlan?.steps.map((step) => step.state),
    ["completed", "in_progress"],
  );
});

test("labels the first blocked plan item instead of falling back to step one", () => {
  const plan: SessionPlan = {
    eventId: "plan",
    sessionRevision: 2,
    agentRunId: "run-1",
    planId: "plan-1",
    title: "Plan",
    completed: false,
    steps: [
      {
        id: "step-1",
        position: 0,
        title: "Inspect",
        state: "completed",
        detail: null,
      },
      {
        id: "step-2",
        position: 1,
        title: "Wait for approval",
        state: "blocked",
        detail: null,
      },
      {
        id: "step-3",
        position: 2,
        title: "Verify",
        state: "pending",
        detail: null,
      },
    ],
  };

  assert.equal(formatSessionPlanProgress(plan), "Step 2 / 3");
});

test("attaches a completed plan to the explicit summary message", () => {
  const events: SessionTranscriptEvent[] = [
    {
      ...base,
      eventId: "plan",
      agentRunId: "run-1",
      eventType: "task_plan",
      planId: "plan-1",
      title: "Plan",
      supersedesPlanId: null,
      steps: [{ id: "step-1", position: 0, title: "Finish the work" }],
    },
    {
      ...base,
      eventId: "complete-step",
      agentRunId: "run-1",
      eventType: "task_step_update",
      taskStepId: "step-1",
      state: "completed",
      detail: null,
    },
    {
      ...base,
      eventId: "presentation",
      agentRunId: "run-1",
      eventType: "agent_run_presentation",
      mode: "collapsible",
      initialState: "collapsed",
      summaryMessageEventId: "summary",
      label: null,
    },
    {
      ...base,
      eventId: "final",
      agentRunId: "run-1",
      eventType: "message",
      role: "assistant",
      messageKind: "final",
      status: "completed",
      text: "The work is complete.",
    },
    {
      ...base,
      eventId: "summary",
      agentRunId: "run-1",
      eventType: "message",
      role: "assistant",
      messageKind: "run_summary",
      status: "completed",
      text: "Summary of the completed work.",
    },
  ];

  const presentation = buildSessionPlanPresentation(events);
  assert.equal(presentation.activePlan, null);
  assert.equal(
    presentation.completedPlanByMessageEventId.get("summary")?.planId,
    "plan-1",
  );
  assert.equal(presentation.completedPlanByMessageEventId.has("final"), false);
});

test("falls back to the final assistant message when no summary is provided", () => {
  const events: SessionTranscriptEvent[] = [
    {
      ...base,
      eventId: "plan",
      agentRunId: "run-1",
      eventType: "task_plan",
      planId: "plan-1",
      title: "Plan",
      supersedesPlanId: null,
      steps: [{ id: "step-1", position: 0, title: "Finish the work" }],
    },
    {
      ...base,
      eventId: "complete-step",
      agentRunId: "run-1",
      eventType: "task_step_update",
      taskStepId: "step-1",
      state: "completed",
      detail: null,
    },
    {
      ...base,
      eventId: "final",
      agentRunId: "run-1",
      eventType: "message",
      role: "assistant",
      messageKind: "final",
      status: "completed",
      text: "The work is complete.",
    },
  ];

  const presentation = buildSessionPlanPresentation(events);
  assert.equal(
    presentation.completedPlanByMessageEventId.get("final")?.planId,
    "plan-1",
  );
});
