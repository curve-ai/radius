import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_RESPONSE_EDGE_GAP_PX,
  CHAT_TURN_TOP_GAP_PX,
  isChatFollowCancelKey,
  submittedTurnScrollLayout,
} from "./chat-scroll";

test("a short response gets only the temporary space needed to anchor its prompt", () => {
  const layout = submittedTurnScrollLayout({
    anchorTop: 900,
    composerHeight: 120,
    contentEnd: 1_020,
    viewportHeight: 720,
  });

  assert.deepEqual(layout, {
    anchorScrollTop: 900 - CHAT_TURN_TOP_GAP_PX,
    turnSpacerHeight:
      900 -
      CHAT_TURN_TOP_GAP_PX +
      720 -
      1_020 -
      120 -
      CHAT_RESPONSE_EDGE_GAP_PX,
  });
});

test("temporary space contracts as the response grows and disappears at the real edge", () => {
  const short = submittedTurnScrollLayout({
    anchorTop: 900,
    composerHeight: 120,
    contentEnd: 1_120,
    viewportHeight: 720,
  });
  const long = submittedTurnScrollLayout({
    anchorTop: 900,
    composerHeight: 120,
    contentEnd: 1_620,
    viewportHeight: 720,
  });

  assert.ok(short.turnSpacerHeight > 0);
  assert.equal(long.turnSpacerHeight, 0);
});

test("the response edge retains the composer height plus the 24px gap", () => {
  const layout = submittedTurnScrollLayout({
    anchorTop: 24,
    composerHeight: 104,
    contentEnd: 592,
    viewportHeight: 720,
  });

  assert.equal(layout.anchorScrollTop, 0);
  assert.equal(
    layout.turnSpacerHeight,
    720 - 592 - 104 - CHAT_RESPONSE_EDGE_GAP_PX,
  );
});

test("only actual scroll keys cancel response following", () => {
  assert.equal(isChatFollowCancelKey("PageUp"), true);
  assert.equal(isChatFollowCancelKey("ArrowDown"), true);
  assert.equal(isChatFollowCancelKey(" "), true);
  assert.equal(isChatFollowCancelKey("Enter"), false);
  assert.equal(isChatFollowCancelKey("a"), false);
});
