import assert from "node:assert/strict";
import { test } from "node:test";

import { measureLayoutMb } from "./importable.js";

const MB = 1024 * 1024;

test("compressed layers are scaled up; docker save's plain tar layers are not", async () => {
  const size = await measureLayoutMb("unused", {
    layers: [
      { mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", size: MB },
      { mediaType: "application/vnd.oci.image.layer.v1.tar", size: 10 * MB },
    ],
  });
  assert.equal(size, 4 + 10);
});
