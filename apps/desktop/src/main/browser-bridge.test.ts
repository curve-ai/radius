import assert from "node:assert/strict";
import test from "node:test";

import {
  RADIUS_BROWSER_EXTENSION_ID,
  RADIUS_BROWSER_NATIVE_HOST,
} from "@curve-ai/radius-browser-protocol";

test("uses a stable extension and native-host identity", () => {
  assert.match(RADIUS_BROWSER_EXTENSION_ID, /^[a-p]{32}$/);
  assert.equal(RADIUS_BROWSER_NATIVE_HOST, "ai.curve.radius.browser");
});
