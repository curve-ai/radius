import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  applyFxThinkingEffort,
  fxThinkingEffortsForModel,
} from "./fx-reasoning";

describe("fx reasoning effort", () => {
  test("advertises the supported effort catalog for known Codex models", () => {
    assert.deepEqual(
      fxThinkingEffortsForModel("gpt-5.6-luna").map((option) => option.id),
      ["auto", "none", "low", "medium", "high", "xhigh", "max"],
    );
    assert.deepEqual(
      fxThinkingEffortsForModel("openai/gpt-5.4-mini").map(
        (option) => option.id,
      ),
      ["auto", "none", "low", "medium", "high", "xhigh"],
    );
    assert.deepEqual(fxThinkingEffortsForModel("provider/future-model"), []);
  });

  test("overrides effort without discarding unrelated fx settings", () => {
    assert.deepEqual(
      JSON.parse(
        applyFxThinkingEffort(
          JSON.stringify({ provider: "codex", codex_model: "gpt-5.6-luna" }),
          "high",
        ),
      ),
      {
        provider: "codex",
        codex_model: "gpt-5.6-luna",
        effort: "high",
      },
    );
  });

  test("rejects a non-object settings document", () => {
    assert.throws(
      () => applyFxThinkingEffort("[]", "high"),
      /FX_SETTINGS_INVALID/,
    );
  });
});
