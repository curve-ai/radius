import assert from "node:assert/strict";
import test from "node:test";

import {
  appendAttachmentFiles,
  attachmentFileKey,
  attachmentFilesFromDataTransfer,
  dataTransferContainsFiles,
} from "./attachment-files";

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

test("reads pasted or dropped files from the direct file list", () => {
  const file = new File(["content"], "notes.txt", { type: "text/plain" });
  const dataTransfer = {
    files: [file],
    items: [],
    types: ["Files"],
  } as unknown as DataTransfer;

  assert.equal(dataTransferContainsFiles(dataTransfer), true);
  assert.deepEqual(attachmentFilesFromDataTransfer(dataTransfer), [file]);
});

test("falls back to file items when the direct file list is empty", () => {
  const file = new File(["image"], "capture.png", { type: "image/png" });
  const dataTransfer = {
    files: [],
    items: [
      {
        kind: "file",
        getAsFile: () => file,
      },
    ],
    types: ["image/png"],
  } as unknown as DataTransfer;

  assert.equal(dataTransferContainsFiles(dataTransfer), true);
  assert.deepEqual(attachmentFilesFromDataTransfer(dataTransfer), [file]);
});

test("leaves text-only clipboard data alone", () => {
  const dataTransfer = {
    files: [],
    items: [
      {
        kind: "string",
        getAsFile: () => null,
      },
    ],
    types: ["text/plain"],
  } as unknown as DataTransfer;

  assert.equal(dataTransferContainsFiles(dataTransfer), false);
  assert.deepEqual(attachmentFilesFromDataTransfer(dataTransfer), []);
});
