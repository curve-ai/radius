import assert from "node:assert/strict";
import test from "node:test";

import { applyAgentSessionTitleUpdate } from "./agent-session-title";

test("normalizes and forwards an ACP-generated session title", async () => {
  const titles: string[] = [];

  const handled = await applyAgentSessionTitleUpdate(
    {
      updateTitle: async (title) => {
        titles.push(title);
      },
    },
    {
      sessionUpdate: "session_info_update",
      title: "  Debug\n authentication\t timeout  ",
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(titles, ["Debug authentication timeout"]);
});

test("bounds generated titles and ignores clear or empty updates", async () => {
  const titles: string[] = [];
  const target = {
    updateTitle: async (title: string) => {
      titles.push(title);
    },
  };

  await applyAgentSessionTitleUpdate(target, {
    sessionUpdate: "session_info_update",
    title: "x".repeat(121),
  });
  await applyAgentSessionTitleUpdate(target, {
    sessionUpdate: "session_info_update",
    title: null,
  });
  await applyAgentSessionTitleUpdate(target, {
    sessionUpdate: "session_info_update",
    title: " \n ",
  });

  assert.deepEqual(titles, ["x".repeat(120)]);
});

test("leaves unrelated ACP updates for the runtime mapper", async () => {
  const handled = await applyAgentSessionTitleUpdate(
    { updateTitle: async () => undefined },
    {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Done" },
    },
  );

  assert.equal(handled, false);
});
