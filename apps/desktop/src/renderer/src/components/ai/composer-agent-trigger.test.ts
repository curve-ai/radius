import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { composerAgentTriggerPresentation } from "./composer-agent-trigger";

describe("composer agent trigger presentation", () => {
  test("omits a sole agent when model and thinking effort are available", () => {
    assert.deepEqual(
      composerAgentTriggerPresentation({
        agentCount: 1,
        agentLabel: "fx",
        modelLabel: "gpt-5.6-luna",
        thinkingEffortLabel: "Default",
      }),
      {
        accessibleLabel:
          "Agent: fx. Model: gpt-5.6-luna. Thinking effort: Default",
        configurationLabel: "gpt-5.6-luna · Default",
        showAgentLabel: false,
      },
    );
  });

  test("keeps the active agent visible when multiple agents are available", () => {
    assert.equal(
      composerAgentTriggerPresentation({
        agentCount: 2,
        agentLabel: "fx",
        modelLabel: "gpt-5.6-luna",
        thinkingEffortLabel: "High",
      }).showAgentLabel,
      true,
    );
  });

  test("falls back to the agent name when configuration is incomplete", () => {
    assert.deepEqual(
      composerAgentTriggerPresentation({
        agentCount: 1,
        agentLabel: "fx",
        modelLabel: "gpt-5.6-luna",
        thinkingEffortLabel: null,
      }),
      {
        accessibleLabel: "Agent: fx. Model: gpt-5.6-luna",
        configurationLabel: null,
        showAgentLabel: true,
      },
    );
  });

  test("shows the empty selection prompt when no agent is available", () => {
    assert.deepEqual(
      composerAgentTriggerPresentation({
        agentCount: 0,
        agentLabel: null,
        modelLabel: null,
        thinkingEffortLabel: null,
      }),
      {
        accessibleLabel: "Select agent",
        configurationLabel: null,
        showAgentLabel: false,
      },
    );
  });
});
