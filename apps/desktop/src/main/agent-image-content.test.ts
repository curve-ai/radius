import assert from "node:assert/strict";
import test from "node:test";

import { decodeAgentImage } from "./agent-image-content";

test("decodes a supported ACP image block", () => {
  const decoded = decodeAgentImage({
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    mimeType: "image/png",
  });

  assert.equal(decoded.bytes.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(decoded.extension, "png");
  assert.equal(decoded.mimeType, "image/png");
});

test("rejects unsupported and malformed ACP image blocks", () => {
  assert.throws(
    () => decodeAgentImage({ data: "AAAA", mimeType: "image/svg+xml" }),
    /AGENT_IMAGE_TYPE_UNSUPPORTED/,
  );
  assert.throws(
    () => decodeAgentImage({ data: "not base64", mimeType: "image/png" }),
    /AGENT_IMAGE_INVALID/,
  );
});
