import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceSessionRecord } from "./project-context-value";
import { hasUnreadAssistantMessage } from "./session-unread";

const session: WorkspaceSessionRecord = {
  id: "session-1",
  title: "Review the filing",
  status: "completed",
  updatedAt: "2026-08-27T15:02:00.000Z",
  lastAssistantMessageAt: "2026-08-27T15:01:00.000Z",
  pinnedAt: null,
  working: false,
};

test("shows unread only for a newer assistant message outside the active session", () => {
  assert.equal(hasUnreadAssistantMessage(session, null, {}), true);
  assert.equal(
    hasUnreadAssistantMessage(session, null, {
      [session.id]: "2026-08-27T15:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    hasUnreadAssistantMessage(session, null, {
      [session.id]: session.lastAssistantMessageAt!,
    }),
    false,
  );
  assert.equal(hasUnreadAssistantMessage(session, session.id, {}), false);
  assert.equal(
    hasUnreadAssistantMessage(
      { ...session, lastAssistantMessageAt: null },
      null,
      {},
    ),
    false,
  );
});
