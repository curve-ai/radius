import assert from "node:assert/strict";
import { test } from "node:test";
import { ChatWindowRegistry } from "./chat-window-registry";

test("moving and combining chats preserves one owner and chooses a source fallback", () => {
  const registry = new ChatWindowRegistry();
  registry.move("a", "one");
  registry.move("b", "one");
  registry.move("b", "two");
  assert.deepEqual(registry.groups.get("one"), {
    sessionIds: ["a"],
    activeSessionId: "a",
  });
  assert.equal(registry.owner("b"), "two");
  registry.move("a", "two", "b");
  assert.deepEqual(registry.groups.get("two")?.sessionIds, ["a", "b"]);
  registry.move("a", "two");
  assert.deepEqual(registry.groups.get("two")?.sessionIds, ["b", "a"]);
  registry.move("a", "main");
  assert.equal(registry.owner("a"), "main");
  assert.deepEqual(registry.detached(), { b: "two" });
});

test("closing a group makes its chats available in main without touching other groups", () => {
  const registry = new ChatWindowRegistry();
  registry.move("a", "one");
  registry.move("b", "two");
  registry.removeWindow("one");
  assert.equal(registry.owner("a"), "main");
  assert.equal(registry.owner("b"), "two");
});
