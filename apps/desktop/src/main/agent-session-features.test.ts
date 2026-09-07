import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_SESSION_FEATURE_CLIENT_CAPABILITIES,
  agentSessionFeatureOverrideKey,
  applyAgentSessionFeatureUpdate,
  createAgentSessionFeatureState,
  resolveAgentSessionConfigSelection,
  resolveAgentSessionFeatureOwner,
  resolveAgentSessionModeSelection,
  type AgentSessionConfigOption,
} from "./agent-session-features";

const configOptions: AgentSessionConfigOption[] = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "fast",
    options: [
      {
        group: "fast",
        name: "Fast models",
        options: [{ value: "fast", name: "Fast" }],
      },
      {
        group: "deep",
        name: "Deep models",
        options: [{ value: "deep", name: "Deep" }],
      },
    ],
  },
  {
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue: "agent",
    options: [{ value: "agent", name: "Agent" }],
  },
  {
    id: "thought",
    name: "Thinking",
    category: "thought_level",
    type: "select",
    currentValue: "high",
    options: [{ value: "high", name: "High" }],
  },
  {
    id: "temperature",
    name: "Temperature",
    category: "model_config",
    type: "select",
    currentValue: "balanced",
    options: [{ value: "balanced", name: "Balanced" }],
  },
  {
    id: "custom",
    name: "Custom behavior",
    category: "_vendor_behavior",
    type: "select",
    currentValue: "one",
    options: [{ value: "one", name: "One" }],
    _meta: { vendor: true },
  },
  {
    id: "web",
    name: "Use web",
    type: "boolean",
    currentValue: false,
  },
];

test("preserves ordered config options, unknown categories, modes, and commands", () => {
  const state = createAgentSessionFeatureState({
    configOptions,
    modes: {
      currentModeId: "ask",
      availableModes: [
        { id: "ask", name: "Ask" },
        { id: "agent", name: "Agent", description: "Make changes" },
      ],
    },
  });

  assert.deepEqual(
    state.configOptions.map((option) => option.id),
    ["model", "mode", "thought", "temperature", "custom", "web"],
  );
  assert.deepEqual(AGENT_SESSION_FEATURE_CLIENT_CAPABILITIES, {
    session: { configOptions: { boolean: {} } },
    plan: {},
  });

  applyAgentSessionFeatureUpdate(state, {
    sessionUpdate: "available_commands_update",
    availableCommands: [
      {
        name: "review",
        description: "Review the current change",
        input: { hint: "optional focus" },
      },
      { name: "test", description: "Run focused tests" },
    ],
  });
  assert.deepEqual(
    state.availableCommands.map((command) => command.name),
    ["review", "test"],
  );

  applyAgentSessionFeatureUpdate(state, {
    sessionUpdate: "current_mode_update",
    currentModeId: "agent",
  });
  assert.equal(state.modes?.currentModeId, "agent");
  assert.deepEqual(resolveAgentSessionModeSelection(state.modes, "ask"), {
    modeId: "ask",
  });
  assert.equal(resolveAgentSessionModeSelection(state.modes, "unknown"), null);
});

test("config updates replace the full list and selections require advertised values", () => {
  const state = createAgentSessionFeatureState({ configOptions });
  const next = [configOptions[4]!, configOptions[0]!, configOptions[5]!];

  applyAgentSessionFeatureUpdate(state, {
    sessionUpdate: "config_option_update",
    configOptions: next,
  });

  assert.deepEqual(
    state.configOptions.map((option) => option.id),
    ["custom", "model", "web"],
  );
  assert.deepEqual(
    resolveAgentSessionConfigSelection(state.configOptions, "model", "deep"),
    { configId: "model", type: "select", value: "deep" },
  );
  assert.deepEqual(
    resolveAgentSessionConfigSelection(state.configOptions, "web", true),
    { configId: "web", type: "boolean", value: true },
  );
  assert.equal(
    resolveAgentSessionConfigSelection(state.configOptions, "model", "other"),
    null,
  );
  assert.equal(
    resolveAgentSessionConfigSelection(state.configOptions, "web", "true"),
    null,
  );
  assert.equal(
    resolveAgentSessionConfigSelection(state.configOptions, "missing", true),
    null,
  );
});

test("usage updates replace the current ACP usage snapshot", () => {
  const state = createAgentSessionFeatureState();
  applyAgentSessionFeatureUpdate(state, {
    sessionUpdate: "usage_update",
    used: 30,
    size: 120,
    cost: { amount: 0.25, currency: "USD" },
  });
  assert.deepEqual(state.usage, {
    used: 30,
    size: 120,
    cost: { amount: 0.25, currency: "USD" },
  });
});

test("leaves unrelated ACP updates to other projectors", () => {
  const state = createAgentSessionFeatureState();
  applyAgentSessionFeatureUpdate(state, {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "Done" },
  });
  assert.deepEqual(state, createAgentSessionFeatureState());
});

test("keeps feature state and override keys isolated by provider agent", () => {
  const first = resolveAgentSessionFeatureOwner(
    undefined,
    "agent-a",
    "provider:agent-a",
  );
  first.state.availableCommands = [
    { name: "first", description: "First agent command" },
  ];

  assert.equal(
    resolveAgentSessionFeatureOwner(first, "agent-a", "provider:agent-a"),
    first,
  );
  const second = resolveAgentSessionFeatureOwner(
    first,
    "agent-b",
    "provider:agent-b",
  );
  assert.equal(second.agentId, "agent-b");
  assert.deepEqual(second.state.availableCommands, []);
  assert.notEqual(
    agentSessionFeatureOverrideKey("session", first.providerKey),
    agentSessionFeatureOverrideKey("session", second.providerKey),
  );
});
