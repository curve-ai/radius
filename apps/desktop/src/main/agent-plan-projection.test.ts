import assert from "node:assert/strict";
import test from "node:test";

import {
  agentPlanReasoningSummaries,
  applyAgentPlanProjectionUpdate,
  createAgentPlanProjectionState,
} from "./agent-plan-projection";

const build = {
  content: "Build",
  priority: "high" as const,
  status: "in_progress" as const,
};
const verify = {
  content: "Verify",
  priority: "medium" as const,
  status: "pending" as const,
};

test("keeps independent experimental plans and falls back after removal", () => {
  const state = createAgentPlanProjectionState();
  assert.deepEqual(
    applyAgentPlanProjectionUpdate(state, {
      sessionUpdate: "plan_update",
      plan: { type: "items", planId: "build", entries: [build] },
    }),
    { canonicalEntries: [build] },
  );
  assert.deepEqual(
    applyAgentPlanProjectionUpdate(state, {
      sessionUpdate: "plan_update",
      plan: { type: "items", planId: "verify", entries: [verify] },
    }),
    { canonicalEntries: [verify] },
  );
  assert.deepEqual(
    applyAgentPlanProjectionUpdate(state, {
      sessionUpdate: "plan_removed",
      planId: "verify",
    }),
    { canonicalEntries: [build] },
  );
});

test("type changes and empty replacements clear only the matching item plan", () => {
  const state = createAgentPlanProjectionState();
  applyAgentPlanProjectionUpdate(state, {
    sessionUpdate: "plan",
    entries: [verify],
  });
  applyAgentPlanProjectionUpdate(state, {
    sessionUpdate: "plan_update",
    plan: { type: "items", planId: "build", entries: [build] },
  });
  assert.deepEqual(
    applyAgentPlanProjectionUpdate(state, {
      sessionUpdate: "plan_update",
      plan: { type: "markdown", planId: "build", content: "# Revised" },
    }),
    { canonicalEntries: [verify] },
  );
  applyAgentPlanProjectionUpdate(state, {
    sessionUpdate: "plan_update",
    plan: { type: "items", planId: "empty", entries: [build] },
  });
  assert.deepEqual(
    applyAgentPlanProjectionUpdate(state, {
      sessionUpdate: "plan_update",
      plan: { type: "items", planId: "empty", entries: [] },
    }),
    { canonicalEntries: [verify] },
  );
});

test("keeps only final active markdown and file plan summaries", () => {
  const state = createAgentPlanProjectionState();
  applyAgentPlanProjectionUpdate(state, {
    sessionUpdate: "plan_update",
    plan: { type: "markdown", planId: "notes", content: "# First" },
  });
  applyAgentPlanProjectionUpdate(state, {
    sessionUpdate: "plan_update",
    plan: { type: "markdown", planId: "notes", content: "# Final" },
  });
  applyAgentPlanProjectionUpdate(state, {
    sessionUpdate: "plan_update",
    plan: { type: "file", planId: "source", uri: "file:///private/PLAN.md" },
  });
  applyAgentPlanProjectionUpdate(state, {
    sessionUpdate: "plan_removed",
    planId: "source",
  });

  assert.deepEqual(agentPlanReasoningSummaries(state), ["# Final"]);
});

test("bounds independently addressed experimental plans", () => {
  const state = createAgentPlanProjectionState();
  for (let index = 0; index < 40; index += 1) {
    applyAgentPlanProjectionUpdate(state, {
      sessionUpdate: "plan_update",
      plan: {
        type: "markdown",
        planId: `plan-${index}`,
        content: `Plan ${index}`,
      },
    });
  }
  assert.equal(state.experimental.size, 32);
  assert.equal(state.experimental.has("plan-39"), false);
});
