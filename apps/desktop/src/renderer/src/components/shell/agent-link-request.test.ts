import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_LINK_REQUEST_TTL_MS,
  onAgentLinkRequest,
  requestAgentFromLink,
  takeLinkedAgent,
} from "./agent-link-request";

const bundled = { id: "fx" };
const development = { id: "agent_abc123" };

test("uses the first agent when no link is pending", () => {
  assert.equal(takeLinkedAgent([bundled, development]), bundled);
  assert.equal(takeLinkedAgent([]), null);
});

test("keeps a link pending until its agent is listed, then uses it once", () => {
  requestAgentFromLink(development.id);

  // `radius dev` registers the agent just before opening the link, so the
  // first load can miss it.
  assert.equal(takeLinkedAgent([bundled]), bundled);
  assert.equal(takeLinkedAgent([bundled, development]), development);
  assert.equal(takeLinkedAgent([bundled, development]), bundled);
});

test("notifies listeners of a new link until they unsubscribe", () => {
  let notified = 0;
  const unsubscribe = onAgentLinkRequest(() => {
    notified += 1;
  });
  requestAgentFromLink(development.id);
  unsubscribe();
  requestAgentFromLink(development.id);

  assert.equal(notified, 1);
  takeLinkedAgent([development]);
});

test("forgets a link whose agent never became usable", () => {
  requestAgentFromLink(development.id, 1_000);

  assert.equal(takeLinkedAgent([bundled], 2_000), bundled);
  // Much later the agent appears, but nobody is waiting for it any more.
  assert.equal(
    takeLinkedAgent(
      [bundled, development],
      1_000 + AGENT_LINK_REQUEST_TTL_MS + 1,
    ),
    bundled,
  );
});
