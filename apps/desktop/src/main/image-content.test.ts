import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  readBoundedImageFile,
  radiusImageMimeTypeForPath,
} from "./image-content";

test("uses the final path extension for image MIME detection", () => {
  assert.equal(radiusImageMimeTypeForPath("/tmp/folder.with.dot/image"), null);
  assert.equal(radiusImageMimeTypeForPath("/tmp/photo.JPEG"), "image/jpeg");
});

test("reads local image bytes without crossing the configured limit", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "radius-image-"));
  const filePath = path.join(directory, "image.png");
  try {
    await writeFile(filePath, Buffer.from([1, 2, 3, 4]));
    assert.deepEqual(
      await readBoundedImageFile(filePath, 4),
      Buffer.from([1, 2, 3, 4]),
    );
    await assert.rejects(
      readBoundedImageFile(filePath, 3),
      /RADIUS_IMAGE_TOO_LARGE/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
