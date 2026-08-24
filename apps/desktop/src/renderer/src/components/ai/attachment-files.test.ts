import assert from "node:assert/strict";
import test from "node:test";

import { appendAttachmentFiles, attachmentFileKey } from "./attachment-files";

test("keeps distinct files even when their metadata matches", () => {
  const first = new File(["same"], "notes.txt", {
    type: "text/plain",
    lastModified: 1,
  });
  const second = new File(["same"], "notes.txt", {
    type: "text/plain",
    lastModified: 1,
  });

  assert.deepEqual(appendAttachmentFiles([], [first, second]), [first, second]);
});

test("reuses the current array and stable key for the same File object", () => {
  const file = new File(["content"], "notes.txt", { type: "text/plain" });
  const current = [file];

  assert.equal(appendAttachmentFiles(current, [file]), current);
  assert.equal(attachmentFileKey(file), attachmentFileKey(file));
});
