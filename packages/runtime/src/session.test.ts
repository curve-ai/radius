import assert from "node:assert/strict";
import test from "node:test";

import {
  PROTOCOL_VERSION,
  agent,
  methods,
  type AgentContext,
  type PromptRequest,
} from "@agentclientprotocol/sdk";

import { connectAcpRuntime } from "./session.js";

test("streams messages and bridges an exact permission decision", async () => {
  const sessionId = "runtime-test-session";
  let selectedModel: string | null = null;
  let suppliedMcpServerUrl: string | null = null;
  const fakeAgent = agent({ name: "runtime-test-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
    }))
    .onRequest(methods.agent.session.new, (context) => {
      const server = context.params.mcpServers[0];
      suppliedMcpServerUrl =
        server && "url" in server ? String(server.url) : null;
      return {
        sessionId,
        configOptions: [
          {
            id: "provider",
            name: "Provider",
            category: "model",
            type: "select",
            currentValue: "codex",
            options: [{ value: "codex", name: "Codex subscription" }],
          },
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "codex/fast",
            options: [
              { value: "codex/fast", name: "Codex Fast" },
              { value: "codex/deep", name: "Codex Deep" },
            ],
          },
        ],
      };
    })
    .onRequest(methods.agent.session.setConfigOption, (context) => {
      selectedModel = String(context.params.value);
      return { configOptions: [] };
    })
    .onRequest(
      methods.agent.session.prompt,
      async (context): Promise<{ stopReason: "end_turn" }> => {
        await sendTestTurn(context.params, context.client);
        return { stopReason: "end_turn" };
      },
    )
    .onNotification(methods.agent.session.cancel, () => undefined);

  const updates: string[] = [];
  let permissionTitle: string | null = null;
  const runtime = await connectAcpRuntime(fakeAgent, {
    cwd: "/tmp/radius-runtime-test",
    mcpServers: [
      {
        type: "http",
        name: "radius-browser",
        url: "http://192.168.64.1:4567/mcp",
        headers: [{ name: "Authorization", value: "Bearer test" }],
      },
    ],
    modelId: "codex/deep",
    handlers: {
      onPermissionRequest: async (request) => {
        permissionTitle = request.toolCall.title ?? null;
        return { outcome: "selected", optionId: "allow-once" };
      },
      onUpdate: (notification) => {
        updates.push(notification.update.sessionUpdate);
      },
    },
  });

  try {
    const result = await runtime.prompt("Hello");
    assert.equal(runtime.sessionId, sessionId);
    assert.equal(selectedModel, "codex/deep");
    assert.equal(suppliedMcpServerUrl, "http://192.168.64.1:4567/mcp");
    assert.deepEqual(runtime.availableModels(), [
      { id: "codex/fast", label: "Codex Fast" },
      { id: "codex/deep", label: "Codex Deep" },
    ]);
    assert.equal(result.stopReason, "end_turn");
    assert.equal(result.text, "Hello from the agent");
    assert.equal(permissionTitle, "Use a test tool");
    assert.deepEqual(updates, ["agent_message_chunk", "tool_call"]);
  } finally {
    runtime.close();
  }
});

async function sendTestTurn(
  request: PromptRequest,
  clientContext: AgentContext,
): Promise<void> {
  await clientContext.notify(methods.client.session.update, {
    sessionId: request.sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hello from the agent" },
    },
  });
  await clientContext.notify(methods.client.session.update, {
    sessionId: request.sessionId,
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "test-tool-call",
      title: "Use a test tool",
      kind: "other",
      status: "pending",
      rawInput: { value: 1 },
    },
  });
  const response = await clientContext.request(
    methods.client.session.requestPermission,
    {
      sessionId: request.sessionId,
      toolCall: {
        toolCallId: "test-tool-call",
        title: "Use a test tool",
        kind: "other",
        status: "pending",
        rawInput: { value: 1 },
      },
      options: [
        {
          kind: "allow_once",
          name: "Allow once",
          optionId: "allow-once",
        },
        {
          kind: "reject_once",
          name: "Deny",
          optionId: "deny",
        },
      ],
    },
  );
  assert.deepEqual(response.outcome, {
    outcome: "selected",
    optionId: "allow-once",
  });
}
