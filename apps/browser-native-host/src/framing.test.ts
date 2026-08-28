import assert from "node:assert/strict";
import test from "node:test";

import { frameNativeHostMessage, NativeMessageReader } from "./framing.js";

test("decodes fragmented native messages", () => {
  const frame = frameNativeHostMessage({ type: "ping" });
  const reader = new NativeMessageReader();
  assert.deepEqual(reader.push(frame.subarray(0, 3)), []);
  assert.deepEqual(reader.push(frame.subarray(3)), [{ type: "ping" }]);
});

test("decodes consecutive native messages", () => {
  const reader = new NativeMessageReader();
  const combined = Buffer.concat([
    frameNativeHostMessage({ id: 1 }),
    frameNativeHostMessage({ id: 2 }),
  ]);
  assert.deepEqual(reader.push(combined), [{ id: 1 }, { id: 2 }]);
});
