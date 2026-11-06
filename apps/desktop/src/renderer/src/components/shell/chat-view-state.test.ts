import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureChatViews,
  chatViewReady,
  getChatViewState,
  prepareChatView,
  registerChatView,
  retainChatViewStates,
  restoreChatViewStates,
  saveChatViewState,
} from "./chat-view-state";

const view = {
  agentId: "agent-a",
  modelId: "model-b",
  thinkingEffortId: "high",
  scrollTop: 150,
  scrollAnchor: { eventId: "message-a", offset: -20 },
  atBottom: false,
  toolPanelOpen: false,
};

test("handoff retains view choices and scroll without carrying session-owned composer data", async () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { setTimeout, clearTimeout },
  });
  try {
    saveChatViewState("view", view);
    const states = await captureChatViews("view");
    assert.deepEqual(states.view, view);
    assert.equal("attachments" in states.view, false);
    assert.equal("accessMode" in states.view, false);
    assert.equal("draft" in states.view, false);
    const restored = prepareChatView("view", states.view);
    chatViewReady("view");
    await restored;
    assert.deepEqual(getChatViewState("view"), view);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    retainChatViewStates(() => false);
  }
});

test("a rejected source flush keeps its saved view and live reader", async () => {
  saveChatViewState("busy", view);
  const unregister = registerChatView("busy", async () => {
    throw new Error("Message is sending");
  });
  try {
    await assert.rejects(captureChatViews("busy"), /Message is sending/);
    retainChatViewStates(() => false);
    assert.deepEqual(getChatViewState("busy"), view);
  } finally {
    unregister();
    retainChatViewStates(() => false);
  }
  assert.equal(getChatViewState("busy"), undefined);
});

test("an inactive view waits for outstanding composer persistence before capture", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  saveChatViewState("inactive", view);
  const unregister = registerChatView(
    "inactive",
    async () => view,
    () => pending,
  );
  unregister();
  let captured = false;
  const result = captureChatViews("inactive").then((states) => {
    captured = true;
    return states;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(captured, false);
  release();
  assert.deepEqual((await result).inactive, view);
  retainChatViewStates(() => false);
});

test("window bootstrap restores active and inactive presentation before either mounts", async () => {
  try {
    restoreChatViewStates({
      active: view,
      inactive: { ...view, scrollTop: 250 },
    });
    const firstClose = await captureChatViews();
    retainChatViewStates(() => false);
    restoreChatViewStates(firstClose);
    assert.deepEqual(await captureChatViews(), firstClose);
  } finally {
    retainChatViewStates(() => false);
  }
});
