import assert from "node:assert/strict";
import test from "node:test";

import { BoundedLru } from "./bounded-lru";

test("evicts least-recent entries by count and byte budget", () => {
  const cache = new BoundedLru<string>(2, 6);
  cache.set("first", "first", 2);
  cache.set("second", "second", 2);
  assert.equal(cache.get("first"), "first");

  cache.set("third", "third", 2);
  assert.equal(cache.get("second"), undefined);
  assert.equal(cache.get("first"), "first");

  cache.set("large", "large", 5);
  assert.equal(cache.get("third"), undefined);
  assert.equal(cache.get("first"), undefined);
  assert.equal(cache.get("large"), "large");
});

test("distinguishes cached null values from cache misses", () => {
  const cache = new BoundedLru<string | null>(2, 6);
  cache.set("missing-resource", null, 0);

  assert.equal(cache.get("missing-resource"), null);
  assert.equal(cache.get("unknown-resource"), undefined);
});
