import assert from "node:assert/strict";
import test from "node:test";

import {
  isBrowserBridgeHello,
  isBrowserBridgeRequest,
  isBrowserBridgeResponse,
  RADIUS_BROWSER_PROTOCOL_VERSION,
} from "./index.js";

test("accepts the versioned extension hello", () => {
  assert.equal(
    isBrowserBridgeHello({
      type: "hello",
      protocolVersion: RADIUS_BROWSER_PROTOCOL_VERSION,
      profile: {
        profileId: "work-profile",
        browserName: "Chrome",
        enabled: true,
      },
    }),
    true,
  );
});

test("rejects unknown bridge operations", () => {
  assert.equal(
    isBrowserBridgeRequest({
      type: "request",
      id: "request-1",
      operation: "cookies.export",
      input: {},
    }),
    false,
  );
});

test("accepts bounded response envelopes", () => {
  assert.equal(
    isBrowserBridgeResponse({
      type: "response",
      id: "request-1",
      ok: false,
      error: "BROWSER_TAB_UNAVAILABLE",
    }),
    true,
  );
});
