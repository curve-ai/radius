import assert from "node:assert/strict";
import { test } from "node:test";
import { findChatDropTarget } from "./chat-drop-target";

const window = {
  id: "group",
  stackOrder: 1,
  bounds: { x: -1000, y: -800, width: 650, height: 780 },
  zone: {
    x: 0,
    y: 40,
    width: 256,
    height: 740,
    rows: [
      { sessionId: "a", middle: 120 },
      { sessionId: "b", middle: 152 },
    ],
  },
};
test("desktop drops create windows while content and collapsed sidebars cancel", () => {
  assert.deepEqual(findChatDropTarget({ x: 300, y: 100 }, "a", [window]), {
    kind: "new-window",
  });
  assert.deepEqual(findChatDropTarget({ x: -500, y: -700 }, "a", [window]), {
    kind: "cancel",
  });
  assert.deepEqual(
    findChatDropTarget({ x: -900, y: -700 }, "a", [{ ...window, zone: null }]),
    { kind: "cancel" },
  );
});

test("overlapping destinations follow stacking order while the source has focus", () => {
  const main = { ...window, id: "main", stackOrder: 1 };
  const target = { ...window, id: "target", stackOrder: 2 };
  const source = {
    ...window,
    id: "source",
    stackOrder: 3,
    bounds: { ...window.bounds, x: 800 },
  };
  const point = { x: -900, y: -690 };
  assert.deepEqual(findChatDropTarget(point, "c", [main, source, target]), {
    kind: "move",
    windowId: "target",
    before: "a",
  });
  assert.deepEqual(
    findChatDropTarget(point, "c", [main, source, { ...target, zone: null }]),
    { kind: "cancel" },
  );
  assert.deepEqual(
    findChatDropTarget(point, "c", [
      { ...main, stackOrder: 4 },
      source,
      target,
    ]),
    { kind: "move", windowId: "main", before: "a" },
  );
});
test("sidebar drops preserve negative monitor coordinates and determine insertion order", () => {
  assert.deepEqual(findChatDropTarget({ x: -900, y: -690 }, "c", [window]), {
    kind: "move",
    windowId: "group",
    before: "a",
  });
  assert.deepEqual(findChatDropTarget({ x: -900, y: -660 }, "a", [window]), {
    kind: "move",
    windowId: "group",
    before: "b",
  });
  assert.deepEqual(findChatDropTarget({ x: -900, y: -500 }, "c", [window]), {
    kind: "move",
    windowId: "group",
    before: undefined,
  });
});
