import assert from "node:assert/strict";
import test from "node:test";

import {
  PROTOCOL_VERSION,
  RequestError,
  agent,
  methods,
  type AgentContext,
  type PromptRequest,
} from "@agentclientprotocol/sdk";

import {
  AcpAuthenticationRequiredError,
  AcpProtocolVersionMismatchError,
  connectAcpRuntime,
} from "./session.js";

test("streams messages and bridges an exact permission decision", async () => {
  const sessionId = "runtime-test-session";
  let fileSystemCapabilities = { readTextFile: false, writeTextFile: false };
  let terminalCapability = false;
  let selectedModel: string | null = null;
  let suppliedMcpServerUrl: string | null = null;
  const fakeAgent = agent({ name: "runtime-test-agent" })
    .onRequest(methods.agent.initialize, (context) => {
      terminalCapability = context.params.clientCapabilities?.terminal === true;
      fileSystemCapabilities = {
        readTextFile:
          context.params.clientCapabilities?.fs?.readTextFile === true,
        writeTextFile:
          context.params.clientCapabilities?.fs?.writeTextFile === true,
      };
      return {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: { loadSession: false },
      };
    })
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
      return {
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: String(context.params.value),
            options: [
              { value: "codex/fast", name: "Codex Fast" },
              { value: "codex/deep", name: "Codex Deep" },
            ],
          },
        ],
      };
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
  let terminalReleased = false;
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
      fileSystem: {
        readTextFile: async (request) => {
          assert.equal(request.path, "/tmp/radius-runtime-test/note.txt");
          return { content: "saved" };
        },
        writeTextFile: async (request) => {
          assert.equal(request.path, "/tmp/radius-runtime-test/note.txt");
          assert.equal(request.content, "saved");
        },
      },
      terminal: {
        create: async (request) => {
          assert.equal(request.command, "/bin/pwd");
          assert.equal(request.cwd, "/tmp/radius-runtime-test");
          return { terminalId: "terminal-1" };
        },
        output: async (request) => {
          assert.equal(request.terminalId, "terminal-1");
          return {
            output: "/tmp/radius-runtime-test\n",
            truncated: false,
            exitStatus: { exitCode: 0, signal: null },
          };
        },
        waitForExit: async () => ({ exitCode: 0, signal: null }),
        kill: async () => undefined,
        release: async () => {
          terminalReleased = true;
        },
      },
    },
  });

  try {
    const result = await runtime.prompt("Hello");
    assert.equal(runtime.sessionId, sessionId);
    assert.equal(terminalCapability, true);
    assert.deepEqual(fileSystemCapabilities, {
      readTextFile: true,
      writeTextFile: true,
    });
    assert.equal(selectedModel, "codex/deep");
    assert.equal(suppliedMcpServerUrl, "http://192.168.64.1:4567/mcp");
    assert.deepEqual(runtime.availableModels(), [
      { id: "codex/fast", label: "Codex Fast" },
      { id: "codex/deep", label: "Codex Deep" },
    ]);
    assert.equal(result.stopReason, "end_turn");
    assert.equal(result.text, "Hello from the agent");
    assert.equal(permissionTitle, "Use a test tool");
    assert.equal(terminalReleased, true);
    assert.deepEqual(updates, [
      "session_info_update",
      "agent_message_chunk",
      "tool_call",
    ]);
  } finally {
    runtime.close();
  }
});

test("loads an advertised session, routes replay separately, and exposes initialization", async () => {
  const replayUpdates: string[] = [];
  const ordinaryUpdates: string[] = [];
  const fakeAgent = agent({ name: "load-session-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { additionalDirectories: {} },
      },
      authMethods: [{ id: "browser", name: "Sign in" }],
    }))
    .onRequest(methods.agent.session.load, async (context) => {
      assert.equal(context.params.sessionId, "provider-session-load");
      assert.equal(context.params.cwd, "/tmp/radius-load");
      assert.deepEqual(context.params.additionalDirectories, [
        "/tmp/radius-shared",
      ]);
      await context.client.notify(methods.client.session.update, {
        sessionId: "other-provider-session",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "wrong replay" },
        },
      });
      await context.client.notify(methods.client.session.update, {
        sessionId: context.params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "historical" },
        },
      });
      return { configOptions: [] };
    })
    .onRequest(methods.agent.session.prompt, async (context) => {
      await context.client.notify(methods.client.session.update, {
        sessionId: context.params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "current" },
        },
      });
      return { stopReason: "end_turn" as const };
    });

  const runtime = await connectAcpRuntime(fakeAgent, {
    cwd: "/tmp/radius-load",
    additionalDirectories: ["/tmp/radius-shared"],
    session: { kind: "load", sessionId: "provider-session-load" },
    handlers: {
      onPermissionRequest: async () => ({ outcome: "cancelled" }),
      onReplayUpdate: (notification) => {
        replayUpdates.push(notification.update.sessionUpdate);
      },
      onUpdate: (notification) => {
        ordinaryUpdates.push(notification.update.sessionUpdate);
      },
    },
  });

  try {
    assert.equal(runtime.sessionId, "provider-session-load");
    assert.equal(runtime.lifecycle, "load");
    assert.equal(runtime.agentCapabilities.loadSession, true);
    assert.deepEqual(runtime.sessionCapabilities.additionalDirectories, {});
    assert.deepEqual(runtime.authMethods, [{ id: "browser", name: "Sign in" }]);
    assert.deepEqual(replayUpdates, ["agent_message_chunk"]);
    assert.deepEqual(ordinaryUpdates, []);
    assert.deepEqual(await runtime.prompt("Continue"), {
      stopReason: "end_turn",
      text: "current",
    });
    assert.deepEqual(ordinaryUpdates, ["agent_message_chunk"]);
  } finally {
    runtime.close();
  }
});

test("resumes without replay and replaces the update handler per prompt", async () => {
  const defaultUpdates: string[] = [];
  const firstTurnUpdates: string[] = [];
  const secondTurnUpdates: string[] = [];
  let resumeCalls = 0;
  let setConfigCalls = 0;
  const fakeAgent = agent({ name: "resume-session-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        sessionCapabilities: { resume: {}, additionalDirectories: {} },
      },
    }))
    .onRequest(methods.agent.session.resume, (context) => {
      resumeCalls += 1;
      assert.equal(context.params.sessionId, "provider-session-resume");
      assert.deepEqual(context.params.additionalDirectories, [
        "/tmp/radius-second-root",
      ]);
      return {
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "current",
            options: [
              { value: "current", name: "Current" },
              { value: "stale-release-default", name: "Stale" },
            ],
          },
        ],
      };
    })
    .onRequest(methods.agent.session.setConfigOption, () => {
      setConfigCalls += 1;
      return { configOptions: [] };
    })
    .onRequest(methods.agent.session.prompt, async (context) => {
      const content = context.params.prompt[0];
      assert.equal(content?.type, "text");
      const text = content?.type === "text" ? content.text : "";
      await context.client.notify(methods.client.session.update, {
        sessionId: context.params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `reply:${text}` },
        },
      });
      return { stopReason: "end_turn" as const };
    });

  const runtime = await connectAcpRuntime(fakeAgent, {
    cwd: "/tmp/radius-resume",
    additionalDirectories: ["/tmp/radius-second-root"],
    modelId: "stale-release-default",
    session: { kind: "resume", sessionId: "provider-session-resume" },
    handlers: {
      onPermissionRequest: async () => ({ outcome: "cancelled" }),
      onUpdate: (notification) => {
        defaultUpdates.push(notification.update.sessionUpdate);
      },
    },
  });

  try {
    assert.equal(runtime.lifecycle, "resume");
    assert.equal(resumeCalls, 1);
    assert.equal(setConfigCalls, 0);
    assert.equal(
      (
        await runtime.prompt("one", {
          onUpdate: (notification) => {
            firstTurnUpdates.push(notification.update.sessionUpdate);
          },
        })
      ).text,
      "reply:one",
    );
    assert.equal(
      (
        await runtime.prompt("two", {
          collectText: false,
          onUpdate: (notification) => {
            secondTurnUpdates.push(notification.update.sessionUpdate);
          },
        })
      ).text,
      "",
    );
    assert.deepEqual(defaultUpdates, []);
    assert.deepEqual(firstTurnUpdates, ["agent_message_chunk"]);
    assert.deepEqual(secondTurnUpdates, ["agent_message_chunk"]);
  } finally {
    runtime.close();
  }
});

test("ignores updates that belong to another ACP session", async () => {
  const updates: string[] = [];
  const fakeAgent = agent({ name: "session-identity-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
    }))
    .onRequest(methods.agent.session.new, () => ({
      sessionId: "expected-session",
    }))
    .onRequest(methods.agent.session.prompt, async (context) => {
      await context.client.notify(methods.client.session.update, {
        sessionId: "other-session",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "wrong" },
        },
      });
      await context.client.notify(methods.client.session.update, {
        sessionId: context.params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "expected" },
        },
      });
      return { stopReason: "end_turn" as const };
    });
  const runtime = await connectAcpRuntime(fakeAgent, {
    cwd: "/tmp/radius-session-identity",
    handlers: {
      onPermissionRequest: async () => ({ outcome: "cancelled" }),
      onUpdate: ({ update }) => {
        updates.push(update.sessionUpdate);
      },
    },
  });

  try {
    assert.deepEqual(await runtime.prompt("Continue"), {
      stopReason: "end_turn",
      text: "expected",
    });
    assert.deepEqual(updates, ["agent_message_chunk"]);
  } finally {
    runtime.close();
  }
});

test("gates explicit load and resume by advertised capabilities", async () => {
  const unsupportedAgent = () =>
    agent({ name: "unsupported-continuation-agent" })
      .onRequest(methods.agent.initialize, () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, () => ({
        sessionId: "unused-new-session",
      }));
  const baseOptions = {
    cwd: "/tmp/radius-capability-gate",
    handlers: {
      onPermissionRequest: async () => ({ outcome: "cancelled" }) as const,
    },
  };

  await assert.rejects(
    connectAcpRuntime(unsupportedAgent(), {
      ...baseOptions,
      session: { kind: "load", sessionId: "existing" },
    }),
    /did not advertise ACP session\/load/,
  );
  await assert.rejects(
    connectAcpRuntime(unsupportedAgent(), {
      ...baseOptions,
      session: { kind: "resume", sessionId: "existing" },
    }),
    /did not advertise ACP session\/resume/,
  );
});

test("auto continuation prefers resume and falls back to a reported new session", async () => {
  let loadCalls = 0;
  const resumableAgent = agent({ name: "auto-resume-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { resume: {} },
      },
    }))
    .onRequest(methods.agent.session.load, () => {
      loadCalls += 1;
      return {};
    })
    .onRequest(methods.agent.session.resume, () => ({}));
  const handlers = {
    onPermissionRequest: async () => ({ outcome: "cancelled" }) as const,
  };
  const resumed = await connectAcpRuntime(resumableAgent, {
    cwd: "/tmp/radius-auto",
    session: { kind: "auto", sessionId: "existing-auto" },
    handlers,
  });
  try {
    assert.equal(resumed.lifecycle, "resume");
    assert.equal(resumed.sessionId, "existing-auto");
    assert.equal(loadCalls, 0);
  } finally {
    resumed.close();
  }

  let receivedAdditionalDirectories: string[] | undefined;
  const fallbackAgent = agent({ name: "auto-new-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
    }))
    .onRequest(methods.agent.session.new, (context) => {
      receivedAdditionalDirectories = context.params.additionalDirectories;
      return { sessionId: "replacement-session" };
    });
  const replacement = await connectAcpRuntime(fallbackAgent, {
    cwd: "/tmp/radius-auto",
    additionalDirectories: ["/tmp/must-not-be-sent"],
    session: { kind: "auto", sessionId: "unavailable-session" },
    handlers,
  });
  try {
    assert.equal(replacement.lifecycle, "new");
    assert.equal(replacement.sessionId, "replacement-session");
    assert.equal(receivedAdditionalDirectories, undefined);
  } finally {
    replacement.close();
  }
});

test("auto continuation falls through only missing-session protocol errors", async () => {
  const sessionId = "missing-provider-session";
  let loadCalls = 0;
  let newSessionCalls = 0;
  const loadFallbackAgent = agent({ name: "auto-missing-resume-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { resume: {} },
      },
    }))
    .onRequest(methods.agent.session.resume, () => {
      throw RequestError.resourceNotFound(sessionId);
    })
    .onRequest(methods.agent.session.load, () => {
      loadCalls += 1;
      return {};
    })
    .onRequest(methods.agent.session.new, () => {
      newSessionCalls += 1;
      return { sessionId: "must-not-be-new" };
    });
  const handlers = {
    onPermissionRequest: async () => ({ outcome: "cancelled" }) as const,
  };
  const loaded = await connectAcpRuntime(loadFallbackAgent, {
    cwd: "/tmp/radius-auto-missing",
    session: { kind: "auto", sessionId },
    handlers,
  });
  try {
    assert.equal(loaded.lifecycle, "load");
    assert.equal(loaded.sessionId, sessionId);
    assert.equal(loadCalls, 1);
    assert.equal(newSessionCalls, 0);
  } finally {
    loaded.close();
  }

  const newFallbackAgent = agent({ name: "auto-all-missing-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { resume: {} },
      },
    }))
    .onRequest(methods.agent.session.resume, () => {
      throw RequestError.resourceNotFound(sessionId);
    })
    .onRequest(methods.agent.session.load, () => {
      throw RequestError.resourceNotFound(sessionId);
    })
    .onRequest(methods.agent.session.new, () => ({
      sessionId: "new-after-missing",
    }));
  const created = await connectAcpRuntime(newFallbackAgent, {
    cwd: "/tmp/radius-auto-all-missing",
    session: { kind: "auto", sessionId },
    handlers,
  });
  try {
    assert.equal(created.lifecycle, "new");
    assert.equal(created.sessionId, "new-after-missing");
  } finally {
    created.close();
  }
});

test("auto continuation preserves unrelated protocol failures", async () => {
  let loadCalls = 0;
  let newSessionCalls = 0;
  const fakeAgent = agent({ name: "auto-auth-error-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { resume: {} },
      },
    }))
    .onRequest(methods.agent.session.resume, () => {
      throw RequestError.authRequired({ reason: "expired" });
    })
    .onRequest(methods.agent.session.load, () => {
      loadCalls += 1;
      return {};
    })
    .onRequest(methods.agent.session.new, () => {
      newSessionCalls += 1;
      return { sessionId: "must-not-be-created" };
    });

  await assert.rejects(
    connectAcpRuntime(fakeAgent, {
      cwd: "/tmp/radius-auto-auth-error",
      session: { kind: "auto", sessionId: "existing-auth-session" },
      handlers: {
        onPermissionRequest: async () => ({ outcome: "cancelled" }),
      },
    }),
    (error: unknown) => error instanceof RequestError && error.code === -32000,
  );
  assert.equal(loadCalls, 0);
  assert.equal(newSessionCalls, 0);
});

test("advertises and dispatches only configured elicitation modes", async () => {
  let advertisedElicitation: unknown;
  let completedElicitationId: string | null = null;
  const fakeAgent = agent({ name: "elicitation-agent" })
    .onRequest(methods.agent.initialize, (context) => {
      advertisedElicitation = context.params.clientCapabilities?.elicitation;
      return {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      };
    })
    .onRequest(methods.agent.session.new, () => ({
      sessionId: "elicitation-session",
    }))
    .onRequest(methods.agent.session.prompt, async (context) => {
      const response = await context.client.request(
        methods.client.elicitation.create,
        {
          mode: "form",
          sessionId: context.params.sessionId,
          message: "Choose a name",
          requestedSchema: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
      );
      assert.deepEqual(response, {
        action: "accept",
        content: { name: "Radius" },
      });
      await context.client.notify(methods.client.elicitation.complete, {
        elicitationId: "elicitation-complete",
      });
      return { stopReason: "end_turn" as const };
    });

  const runtime = await connectAcpRuntime(fakeAgent, {
    cwd: "/tmp/radius-elicitation",
    handlers: {
      onPermissionRequest: async () => ({ outcome: "cancelled" }),
      elicitation: {
        form: async (request) => {
          assert.equal(request.mode, "form");
          return { action: "accept", content: { name: "Radius" } };
        },
        onComplete: (notification) => {
          completedElicitationId = notification.elicitationId;
        },
      },
    },
  });

  try {
    assert.deepEqual(advertisedElicitation, { form: {} });
    await runtime.prompt("Ask me");
    assert.equal(completedElicitationId, "elicitation-complete");
  } finally {
    runtime.close();
  }
});

test("authenticates with an advertised agent method before session setup", async () => {
  const sequence: string[] = [];
  const fakeAgent = agent({ name: "authenticated-agent" })
    .onRequest(methods.agent.initialize, () => {
      sequence.push("initialize");
      return {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
        authMethods: [{ id: "browser-login", name: "Sign in with browser" }],
      };
    })
    .onRequest(methods.agent.authenticate, (context) => {
      sequence.push(`authenticate:${context.params.methodId}`);
      return {};
    })
    .onRequest(methods.agent.session.new, () => {
      sequence.push("session/new");
      return { sessionId: "authenticated-session" };
    });
  const seenMethods: string[][] = [];
  const runtime = await connectAcpRuntime(fakeAgent, {
    cwd: "/tmp/radius-authenticated",
    onAuthenticate: async (authMethods, signal) => {
      assert.equal(signal.aborted, false);
      seenMethods.push(authMethods.map((method) => method.id));
      return "browser-login";
    },
    handlers: {
      onPermissionRequest: async () => ({ outcome: "cancelled" }),
    },
  });

  try {
    assert.equal(runtime.sessionId, "authenticated-session");
    assert.deepEqual(seenMethods, [["browser-login"]]);
    assert.deepEqual(sequence, [
      "initialize",
      "authenticate:browser-login",
      "session/new",
    ]);
  } finally {
    runtime.close();
  }
});

test("continues session setup when protocol authentication is declined", async () => {
  let authenticateCalls = 0;
  const fakeAgent = agent({ name: "declined-auth-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
      authMethods: [{ id: "optional-login", name: "Optional login" }],
    }))
    .onRequest(methods.agent.authenticate, () => {
      authenticateCalls += 1;
      return {};
    })
    .onRequest(methods.agent.session.new, () => ({
      sessionId: "declined-auth-session",
    }));
  const runtime = await connectAcpRuntime(fakeAgent, {
    cwd: "/tmp/radius-declined-auth",
    onAuthenticate: async () => null,
    handlers: {
      onPermissionRequest: async () => ({ outcome: "cancelled" }),
    },
  });

  try {
    assert.equal(runtime.sessionId, "declined-auth-session");
    assert.equal(authenticateCalls, 0);
  } finally {
    runtime.close();
  }
});

test("rejects an unadvertised authentication selection before session setup", async () => {
  let authenticateCalls = 0;
  let newSessionCalls = 0;
  const fakeAgent = agent({ name: "invalid-auth-selection-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
      authMethods: [{ id: "advertised", name: "Advertised login" }],
    }))
    .onRequest(methods.agent.authenticate, () => {
      authenticateCalls += 1;
      return {};
    })
    .onRequest(methods.agent.session.new, () => {
      newSessionCalls += 1;
      return { sessionId: "must-not-start" };
    });

  await assert.rejects(
    connectAcpRuntime(fakeAgent, {
      cwd: "/tmp/radius-invalid-auth",
      onAuthenticate: async () => "not-advertised",
      handlers: {
        onPermissionRequest: async () => ({ outcome: "cancelled" }),
      },
    }),
    /did not advertise ACP authentication method not-advertised/,
  );
  assert.equal(authenticateCalls, 0);
  assert.equal(newSessionCalls, 0);
});

test("never passes a terminal authentication method to authenticate", async () => {
  let authenticateCalls = 0;
  let newSessionCalls = 0;
  const fakeAgent = agent({ name: "terminal-auth-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
      authMethods: [
        {
          id: "terminal-login",
          name: "Interactive login",
          type: "terminal" as const,
          args: ["login"],
        },
      ],
    }))
    .onRequest(methods.agent.authenticate, () => {
      authenticateCalls += 1;
      return {};
    })
    .onRequest(methods.agent.session.new, () => {
      newSessionCalls += 1;
      return { sessionId: "must-not-start" };
    });

  await assert.rejects(
    connectAcpRuntime(fakeAgent, {
      cwd: "/tmp/radius-terminal-auth",
      onAuthenticate: async () => "terminal-login",
      handlers: {
        onPermissionRequest: async () => ({ outcome: "cancelled" }),
      },
    }),
    /requires interactive terminal login/,
  );
  assert.equal(authenticateCalls, 0);
  assert.equal(newSessionCalls, 0);
});

test("gates logout by the advertised agent capability", async () => {
  let logoutCalls = 0;
  const logoutAgent = agent({ name: "logout-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { auth: { logout: {} } },
    }))
    .onRequest(methods.agent.session.new, () => ({
      sessionId: "logout-session",
    }))
    .onRequest(methods.agent.logout, () => {
      logoutCalls += 1;
      return {};
    });
  const handlers = {
    onPermissionRequest: async () => ({ outcome: "cancelled" }) as const,
  };
  const supported = await connectAcpRuntime(logoutAgent, {
    cwd: "/tmp/radius-logout",
    handlers,
  });
  try {
    await supported.logout();
    assert.equal(logoutCalls, 1);
  } finally {
    supported.close();
  }

  const noLogoutAgent = agent({ name: "no-logout-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
    }))
    .onRequest(methods.agent.session.new, () => ({
      sessionId: "no-logout-session",
    }));
  const unsupported = await connectAcpRuntime(noLogoutAgent, {
    cwd: "/tmp/radius-no-logout",
    handlers,
  });
  try {
    await assert.rejects(unsupported.logout(), /did not advertise ACP logout/);
  } finally {
    unsupported.close();
  }
});

test("lists, deletes, and remotely closes sessions when advertised", async () => {
  const listRequests: Array<{ cwd?: string | null; cursor?: string | null }> =
    [];
  const deletedSessionIds: string[] = [];
  const closedSessionIds: string[] = [];
  const fakeAgent = agent({ name: "session-management-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        sessionCapabilities: { list: {}, delete: {}, close: {} },
      },
    }))
    .onRequest(methods.agent.session.new, () => ({
      sessionId: "active-managed-session",
    }))
    .onRequest(methods.agent.session.list, (context) => {
      listRequests.push(context.params);
      return {
        sessions: [
          {
            sessionId: "listed-session",
            cwd: "/tmp/radius-managed",
            title: "Listed session",
          },
        ],
        nextCursor: "next-page",
      };
    })
    .onRequest(methods.agent.session.delete, (context) => {
      deletedSessionIds.push(context.params.sessionId);
      return {};
    })
    .onRequest(methods.agent.session.close, (context) => {
      closedSessionIds.push(context.params.sessionId);
      return {};
    });
  const runtime = await connectAcpRuntime(fakeAgent, {
    cwd: "/tmp/radius-managed",
    handlers: {
      onPermissionRequest: async () => ({ outcome: "cancelled" }),
    },
  });

  try {
    const page = await runtime.listSessions({
      cwd: "/tmp/radius-managed",
      cursor: "current-page",
    });
    assert.deepEqual(listRequests, [
      { cwd: "/tmp/radius-managed", cursor: "current-page" },
    ]);
    assert.deepEqual(page, {
      sessions: [
        {
          sessionId: "listed-session",
          cwd: "/tmp/radius-managed",
          title: "Listed session",
        },
      ],
      nextCursor: "next-page",
    });
    await runtime.deleteSession({ sessionId: "listed-session" });
    await runtime.closeSession();
    assert.deepEqual(deletedSessionIds, ["listed-session"]);
    assert.deepEqual(closedSessionIds, ["active-managed-session"]);
  } finally {
    runtime.close();
  }
});

test("gates provider session management by each advertised capability", async () => {
  const fakeAgent = agent({ name: "unsupported-session-management-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
    }))
    .onRequest(methods.agent.session.new, () => ({
      sessionId: "unsupported-managed-session",
    }));
  const runtime = await connectAcpRuntime(fakeAgent, {
    cwd: "/tmp/radius-unsupported-management",
    handlers: {
      onPermissionRequest: async () => ({ outcome: "cancelled" }),
    },
  });

  try {
    await assert.rejects(
      runtime.listSessions(),
      /did not advertise ACP session\/list/,
    );
    await assert.rejects(
      runtime.deleteSession({ sessionId: "other-session" }),
      /did not advertise ACP session\/delete/,
    );
    await assert.rejects(
      runtime.closeSession(),
      /did not advertise ACP session\/close/,
    );
  } finally {
    runtime.close();
  }
});

async function sendTestTurn(
  request: PromptRequest,
  clientContext: AgentContext,
): Promise<void> {
  await clientContext.request(methods.client.fs.writeTextFile, {
    sessionId: request.sessionId,
    path: "/tmp/radius-runtime-test/note.txt",
    content: "saved",
  });
  const file = await clientContext.request(methods.client.fs.readTextFile, {
    sessionId: request.sessionId,
    path: "/tmp/radius-runtime-test/note.txt",
  });
  assert.equal(file.content, "saved");

  await clientContext.notify(methods.client.session.update, {
    sessionId: request.sessionId,
    update: {
      sessionUpdate: "session_info_update",
      title: "Runtime test session",
    },
  });

  const terminal = await clientContext.request(methods.client.terminal.create, {
    sessionId: request.sessionId,
    command: "/bin/pwd",
    cwd: "/tmp/radius-runtime-test",
  });
  const terminalOutput = await clientContext.request(
    methods.client.terminal.output,
    {
      sessionId: request.sessionId,
      terminalId: terminal.terminalId,
    },
  );
  assert.equal(terminalOutput.output, "/tmp/radius-runtime-test\n");
  await clientContext.request(methods.client.terminal.waitForExit, {
    sessionId: request.sessionId,
    terminalId: terminal.terminalId,
  });
  await clientContext.request(methods.client.terminal.release, {
    sessionId: request.sessionId,
    terminalId: terminal.terminalId,
  });

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

test("sends native credentials only in authenticate, before creating the session", async () => {
  const sequence: string[] = [];
  const expiresAt = new Date(Date.now() + 300000).toISOString();
  const fakeAgent = agent({ name: "native-auth-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
      authMethods: [{ id: "radius-oauth", name: "Sign in" }],
    }))
    .onRequest(methods.agent.authenticate, (context) => {
      sequence.push("authenticate");
      assert.deepEqual(context.params._meta?.["ai.radius/auth"], {
        accessToken: "agent-token",
        expiresAt,
      });
      return {};
    })
    .onRequest(methods.agent.session.new, (context) => {
      sequence.push("session");
      assert.ok(!JSON.stringify(context.params).includes("agent-token"));
      return { sessionId: "authenticated" };
    });
  const runtime = await connectAcpRuntime(fakeAgent, {
    cwd: "/tmp/native-auth",
    handlers: { onPermissionRequest: async () => ({ outcome: "cancelled" }) },
    onAuthenticate: async () => ({
      methodId: "radius-oauth",
      credential: { accessToken: "agent-token", expiresAt },
    }),
  });
  try {
    assert.deepEqual(sequence, ["authenticate", "session"]);
  } finally {
    runtime.close();
  }
});
test("closes the connection when the agent negotiates a different protocol version", async () => {
  let newSessionCalls = 0;
  const fakeAgent = agent({ name: "version-mismatch-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION + 1,
      agentCapabilities: {},
    }))
    .onRequest(methods.agent.session.new, () => {
      newSessionCalls += 1;
      return { sessionId: "must-not-start" };
    });

  await assert.rejects(
    connectAcpRuntime(fakeAgent, {
      cwd: "/tmp/radius-version-mismatch",
      handlers: {
        onPermissionRequest: async () => ({ outcome: "cancelled" }),
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AcpProtocolVersionMismatchError);
      assert.equal(error.requestedVersion, PROTOCOL_VERSION);
      assert.equal(error.agentVersion, PROTOCOL_VERSION + 1);
      return true;
    },
  );
  assert.equal(newSessionCalls, 0);
});

test("reports auth_required from session/new with the advertised methods", async () => {
  const fakeAgent = agent({ name: "auth-required-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
      authMethods: [
        { id: "browser", name: "Sign in with browser" },
        { id: "api-key", name: "API key" },
      ],
    }))
    .onRequest(methods.agent.session.new, () => {
      throw RequestError.authRequired();
    });

  await assert.rejects(
    connectAcpRuntime(fakeAgent, {
      cwd: "/tmp/radius-auth-required",
      handlers: {
        onPermissionRequest: async () => ({ outcome: "cancelled" }),
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AcpAuthenticationRequiredError);
      assert.deepEqual(
        error.authMethods.map((method) => method.id),
        ["browser", "api-key"],
      );
      assert.match(error.message, /browser, api-key/);
      assert.ok(error.cause instanceof RequestError);
      return true;
    },
  );
});

test("reports auth_required from session/load with the advertised methods", async () => {
  const fakeAgent = agent({ name: "auth-required-load-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
      authMethods: [{ id: "browser", name: "Sign in with browser" }],
    }))
    .onRequest(methods.agent.session.load, () => {
      throw RequestError.authRequired();
    });

  await assert.rejects(
    connectAcpRuntime(fakeAgent, {
      cwd: "/tmp/radius-auth-required-load",
      session: { kind: "load", sessionId: "previous-session" },
      handlers: {
        onPermissionRequest: async () => ({ outcome: "cancelled" }),
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AcpAuthenticationRequiredError);
      assert.deepEqual(
        error.authMethods.map((method) => method.id),
        ["browser"],
      );
      return true;
    },
  );
});

test("leaves other session/new failures untouched", async () => {
  const fakeAgent = agent({ name: "other-failure-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
    }))
    .onRequest(methods.agent.session.new, () => {
      throw RequestError.internalError({ reason: "boom" });
    });

  await assert.rejects(
    connectAcpRuntime(fakeAgent, {
      cwd: "/tmp/radius-other-failure",
      handlers: {
        onPermissionRequest: async () => ({ outcome: "cancelled" }),
      },
    }),
    (error: unknown) => {
      assert.ok(!(error instanceof AcpAuthenticationRequiredError));
      assert.ok(error instanceof RequestError);
      return true;
    },
  );
});

test("exposes the negotiated protocol version", async () => {
  const fakeAgent = agent({ name: "version-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
    }))
    .onRequest(methods.agent.session.new, () => ({ sessionId: "s" }));

  const runtime = await connectAcpRuntime(fakeAgent, {
    cwd: "/tmp/radius-version",
    handlers: {
      onPermissionRequest: async () => ({ outcome: "cancelled" }),
    },
  });
  try {
    assert.equal(runtime.protocolVersion, PROTOCOL_VERSION);
  } finally {
    runtime.close();
  }
});
