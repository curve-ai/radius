import assert from "node:assert/strict";
import test from "node:test";

import {
  acpStreamFromWebSocket,
  connectAcpRuntime,
} from "@curve-ai/radius-runtime";

import { defineAgent } from "./index.js";
import { serveDevelopmentAgent } from "./development.js";

test("serves a TypeScript agent through the real ACP client", async () => {
  const observed: Array<{ cwd: string; text: string }> = [];
  let generatedTitle: string | null = null;
  const agent = defineAgent({
    name: "test-agent",
    run: async (context) => {
      observed.push({ cwd: context.cwd, text: context.text });
      await context.setSessionTitle("SDK generated title");
      await context.sendText("Hello ");
      return { text: "from Radius" };
    },
  });

  const runtime = await connectAcpRuntime(agent.app, {
    cwd: "/tmp/radius-sdk-test",
    handlers: {
      onPermissionRequest: async () => ({ outcome: "cancelled" }),
      onUpdate: ({ update }) => {
        if (update.sessionUpdate === "session_info_update") {
          generatedTitle = update.title ?? null;
        }
      },
    },
  });

  try {
    const result = await runtime.prompt("test prompt");
    assert.equal(result.stopReason, "end_turn");
    assert.equal(result.text, "Hello from Radius");
    assert.deepEqual(observed, [
      { cwd: "/tmp/radius-sdk-test", text: "test prompt" },
    ]);
    assert.equal(generatedTitle, "SDK generated title");
  } finally {
    runtime.close();
  }
});

test("propagates cancellation through the SDK abort signal", async () => {
  let aborted = false;
  const agent = defineAgent({
    name: "cancel-agent",
    run: (context) =>
      new Promise((resolve) => {
        context.signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve();
          },
          { once: true },
        );
      }),
  });

  const runtime = await connectAcpRuntime(agent.app, {
    cwd: "/tmp/radius-sdk-cancel-test",
    handlers: {
      onPermissionRequest: async () => ({ outcome: "cancelled" }),
    },
  });

  try {
    const prompt = runtime.prompt("wait");
    await runtime.cancel();
    const result = await prompt;
    assert.equal(result.stopReason, "cancelled");
    assert.equal(aborted, true);
  } finally {
    runtime.close();
  }
});

test("exposes host files and terminal execution through the SDK", async () => {
  let saved = "";
  let released = false;
  const agent = defineAgent({
    name: "host-capability-agent",
    run: async (context) => {
      const path = `${context.cwd}/note.txt`;
      await context.files.writeTextFile({ path, content: "saved" });
      const content = await context.files.readTextFile({ path });
      const terminal = await context.terminal.execute({
        command: "/bin/pwd",
      });
      return `${content}:${terminal.output}`;
    },
  });
  const runtime = await connectAcpRuntime(agent.app, {
    cwd: "/tmp/radius-sdk-host-test",
    handlers: {
      fileSystem: {
        readTextFile: async () => ({ content: saved }),
        writeTextFile: async (request) => {
          saved = request.content;
        },
      },
      onPermissionRequest: async () => ({ outcome: "cancelled" }),
      terminal: {
        create: async (request) => {
          assert.equal(request.cwd, "/tmp/radius-sdk-host-test");
          return { terminalId: "terminal" };
        },
        output: async () => ({
          output: "/tmp/radius-sdk-host-test",
          truncated: false,
          exitStatus: { exitCode: 0, signal: null },
        }),
        waitForExit: async () => ({ exitCode: 0, signal: null }),
        kill: async () => undefined,
        release: async () => {
          released = true;
        },
      },
    },
  });
  try {
    const result = await runtime.prompt("Use host capabilities");
    assert.equal(result.text, "saved:/tmp/radius-sdk-host-test");
    assert.equal(released, true);
  } finally {
    runtime.close();
  }
});

test("serves the same agent over authenticated loopback WebSocket", async () => {
  const agent = defineAgent({
    name: "websocket-agent",
    run: ({ text }) => `WebSocket received: ${text}`,
  });
  const server = await serveDevelopmentAgent(agent, {
    port: 0,
    authorization: "Bearer development-secret",
  });
  const runtime = await connectAcpRuntime(
    acpStreamFromWebSocket(server.endpoint, "Bearer development-secret"),
    {
      cwd: "/tmp/radius-sdk-websocket-test",
      handlers: {
        onPermissionRequest: async () => ({ outcome: "cancelled" }),
      },
    },
  );

  try {
    const result = await runtime.prompt("hello");
    assert.equal(result.text, "WebSocket received: hello");
  } finally {
    runtime.close();
    await server.close();
  }
});
