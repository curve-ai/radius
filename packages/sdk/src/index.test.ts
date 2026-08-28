import assert from "node:assert/strict";
import test from "node:test";

import { connectAcpRuntime } from "@curve-ai/radius-runtime";

import { defineAgent } from "./index.js";

test("serves a TypeScript agent through the real ACP client", async () => {
  const observed: Array<{ cwd: string; text: string }> = [];
  const agent = defineAgent({
    name: "test-agent",
    run: async (context) => {
      observed.push({ cwd: context.cwd, text: context.text });
      await context.sendText("Hello ");
      return { text: "from Radius" };
    },
  });

  const runtime = await connectAcpRuntime(agent.app, {
    cwd: "/tmp/radius-sdk-test",
    handlers: {
      onPermissionRequest: async () => ({ outcome: "cancelled" }),
    },
  });

  try {
    const result = await runtime.prompt("test prompt");
    assert.equal(result.stopReason, "end_turn");
    assert.equal(result.text, "Hello from Radius");
    assert.deepEqual(observed, [
      { cwd: "/tmp/radius-sdk-test", text: "test prompt" },
    ]);
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
