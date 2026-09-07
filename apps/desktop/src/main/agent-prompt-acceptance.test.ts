import assert from "node:assert/strict";
import test from "node:test";

import { acceptAgentPrompt } from "./agent-prompt-acceptance";

test("checks live capabilities before accepting and recording a prompt", async () => {
  const sequence: string[] = [];
  await acceptAgentPrompt({
    assertCapabilities: () => sequence.push("capabilities"),
    appendPrompt: async () => {
      sequence.push("prompt");
    },
    recordAgentRun: async () => {
      sequence.push("run");
    },
    activate: async () => {
      sequence.push("accepted");
    },
  });
  assert.deepEqual(sequence, ["capabilities", "prompt", "run", "accepted"]);
});

test("does not persist or activate a prompt rejected by live capabilities", async () => {
  const sequence: string[] = [];
  await assert.rejects(
    acceptAgentPrompt({
      assertCapabilities: () => {
        sequence.push("capabilities");
        throw new Error("PROMPT_IMAGE_CAPABILITY_REQUIRED");
      },
      appendPrompt: async () => {
        sequence.push("prompt");
      },
      recordAgentRun: async () => {
        sequence.push("run");
      },
      activate: async () => {
        sequence.push("accepted");
      },
    }),
    /PROMPT_IMAGE_CAPABILITY_REQUIRED/,
  );
  assert.deepEqual(sequence, ["capabilities"]);
});
