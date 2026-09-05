import assert from "node:assert/strict";
import test from "node:test";

import {
  composerContextUsageLabel,
  composerLegacyModeFallback,
  composerSessionConfigChoices,
  composerSessionConfigSelectedId,
  composerSessionConfigValue,
  composerSessionConfigValueLabel,
  composerSlashCommandPrompt,
  composerSlashCommandShouldSubmit,
  matchingComposerSlashCommands,
  type ComposerSessionConfigOption,
} from "./composer-session-features";

const modelOption: ComposerSessionConfigOption = {
  id: "model",
  label: "Model",
  description: null,
  category: "model",
  type: "select",
  currentValue: "deep",
  options: [
    {
      id: "fast",
      label: "Fast",
      description: null,
      groupId: null,
      groupLabel: null,
    },
    {
      id: "deep",
      label: "Deep",
      description: null,
      groupId: "reasoning",
      groupLabel: "Reasoning",
    },
  ],
};

test("projects select and boolean options into the compact selector grammar", () => {
  assert.deepEqual(composerSessionConfigChoices(modelOption), [
    { id: "fast", label: "Fast" },
    { id: "deep", label: "Deep" },
  ]);
  assert.equal(composerSessionConfigSelectedId(modelOption), "deep");
  assert.equal(composerSessionConfigValueLabel(modelOption), "Deep");
  assert.equal(composerSessionConfigValue(modelOption, "fast"), "fast");

  const booleanOption: ComposerSessionConfigOption = {
    id: "web",
    label: "Use web",
    description: null,
    category: "_web",
    type: "boolean",
    currentValue: false,
  };
  assert.deepEqual(composerSessionConfigChoices(booleanOption), [
    { id: "true", label: "On" },
    { id: "false", label: "Off" },
  ]);
  assert.equal(composerSessionConfigSelectedId(booleanOption), "false");
  assert.equal(composerSessionConfigValueLabel(booleanOption), "Off");
  assert.equal(composerSessionConfigValue(booleanOption, "true"), true);
});

test("filters slash commands only while entering a command name", () => {
  const commands = [
    { name: "review", description: "Review changes", inputHint: "focus" },
    { name: "research", description: "Research code", inputHint: null },
    { name: "test", description: "Run tests", inputHint: null },
  ];
  assert.deepEqual(
    matchingComposerSlashCommands("/re", commands).map(
      (command) => command.name,
    ),
    ["review", "research"],
  );
  assert.deepEqual(matchingComposerSlashCommands("/REVI", commands), [
    commands[0],
  ]);
  assert.deepEqual(
    matchingComposerSlashCommands("/review focus", commands),
    [],
  );
  assert.deepEqual(matchingComposerSlashCommands("message", commands), []);
  assert.equal(composerSlashCommandPrompt(commands[0]!), "/review ");
  assert.equal(composerSlashCommandPrompt(commands[1]!), "/research");
  assert.equal(
    composerSlashCommandShouldSubmit("/research", commands[1]!),
    true,
  );
  assert.equal(composerSlashCommandShouldSubmit("/rese", commands[1]!), false);
  assert.equal(
    composerSlashCommandShouldSubmit("/review", commands[0]!),
    false,
  );
});

test("formats compact bounded context and cost metadata", () => {
  assert.equal(
    composerContextUsageLabel({
      used: 30,
      size: 120,
      cost: { amount: 0.25, currency: "USD" },
    }),
    "25% context, $0.25",
  );
  assert.equal(
    composerContextUsageLabel({ used: 150, size: 100, cost: null }),
    "100% context",
  );
  assert.equal(
    composerContextUsageLabel({
      used: 0,
      size: 0,
      cost: { amount: 2, currency: "invalid" },
    }),
    "2.00 invalid",
  );
  assert.equal(composerContextUsageLabel(null), null);
});

test("uses legacy ACP modes only when live config has no mode category", () => {
  const modes = {
    currentModeId: "ask",
    availableModes: [
      { id: "ask", label: "Ask", description: null },
      { id: "agent", label: "Agent", description: "Make changes" },
    ],
  };
  assert.deepEqual(composerLegacyModeFallback([modelOption], modes), modes);
  assert.equal(composerLegacyModeFallback(undefined, modes), null);
  assert.equal(
    composerLegacyModeFallback(
      [
        modelOption,
        {
          ...modelOption,
          id: "mode",
          label: "Mode",
          category: "mode",
          currentValue: "agent",
        },
      ],
      modes,
    ),
    null,
  );
});
