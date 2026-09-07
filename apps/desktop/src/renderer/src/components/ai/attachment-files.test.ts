import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PROMPT_ATTACHMENT_COUNT,
  MAX_PROMPT_ATTACHMENT_TOTAL_BYTES,
  MAX_PROMPT_RESOURCE_BYTES,
} from "../../../../radius-api";

import {
  appendAttachmentFiles,
  attachmentFileKey,
  attachmentFilesFromDataTransfer,
  dataTransferContainsFiles,
  PromptAttachmentError,
  serializePromptAttachments,
} from "./attachment-files";

const allPromptCapabilities = {
  audio: true,
  embeddedContext: true,
  image: true,
};

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

test("serializes image and audio files as base64 ACP prompt attachments", async () => {
  const attachments = await serializePromptAttachments(
    [
      new File([new Uint8Array([0, 1, 2])], "folder\\capture.png", {
        type: "image/png",
      }),
      new File([new Uint8Array([3, 4, 5])], "voice.mp3", {
        type: "audio/mpeg",
      }),
    ],
    allPromptCapabilities,
  );

  assert.deepEqual(attachments, [
    {
      type: "image",
      name: "capture.png",
      mimeType: "image/png",
      data: "AAEC",
    },
    {
      type: "audio",
      name: "voice.mp3",
      mimeType: "audio/mpeg",
      data: "AwQF",
    },
  ]);
});

test("serializes text and binary files as embedded ACP resources", async () => {
  const attachments = await serializePromptAttachments(
    [
      new File(["hello"], "notes.md", { type: "" }),
      new File([new Uint8Array([0, 255])], "report.pdf", {
        type: "application/pdf",
      }),
    ],
    allPromptCapabilities,
  );

  assert.deepEqual(attachments, [
    {
      type: "resource",
      name: "notes.md",
      resource: {
        uri: "radius-attachment:///prompt/1/notes.md",
        mimeType: "text/markdown",
        text: "hello",
      },
    },
    {
      type: "resource",
      name: "report.pdf",
      resource: {
        uri: "radius-attachment:///prompt/2/report.pdf",
        mimeType: "application/pdf",
        blob: "AP8=",
      },
    },
  ]);
});

test("uses known prompt capabilities for early attachment feedback", async () => {
  await assert.rejects(
    serializePromptAttachments(
      [new File(["image"], "capture.png", { type: "image/png" })],
      { audio: true, embeddedContext: true, image: false },
    ),
    (error) =>
      error instanceof PromptAttachmentError &&
      error.message === "The selected agent does not accept image attachments.",
  );

  await assert.rejects(
    serializePromptAttachments(
      [new File(["notes"], "notes.txt", { type: "text/plain" })],
      { audio: true, embeddedContext: false, image: true },
    ),
    (error) =>
      error instanceof PromptAttachmentError &&
      error.message === "The selected agent does not accept file attachments.",
  );
});

test("defers capability gating when agent prompt capabilities are unknown", async () => {
  const attachments = await serializePromptAttachments([
    new File(["image"], "capture.png", { type: "image/png" }),
  ]);

  assert.equal(attachments[0]?.type, "image");
});

test("enforces attachment count and total byte bounds before reading", async () => {
  const tiny = new File(["x"], "tiny.txt", { type: "text/plain" });
  await assert.rejects(
    serializePromptAttachments(
      Array.from({ length: MAX_PROMPT_ATTACHMENT_COUNT + 1 }, () => tiny),
    ),
    /Attach up to 10 files at a time\./,
  );

  const oversizedTotal = {
    name: "large.bin",
    type: "application/octet-stream",
    size: MAX_PROMPT_ATTACHMENT_TOTAL_BYTES + 1,
    arrayBuffer: () => Promise.reject(new Error("must not read")),
  } as unknown as File;
  await assert.rejects(
    serializePromptAttachments([oversizedTotal]),
    /Attachments can total up to 25 MB\./,
  );
});

test("enforces the embedded resource byte bound", async () => {
  const oversizedResource = {
    name: "large.pdf",
    type: "application/pdf",
    size: MAX_PROMPT_RESOURCE_BYTES + 1,
    arrayBuffer: () => Promise.reject(new Error("must not read")),
  } as unknown as File;

  await assert.rejects(
    serializePromptAttachments([oversizedResource], allPromptCapabilities),
    /large\.pdf is too large\. This file type can be up to 2 MB\./,
  );
});

test("rejects invalid UTF-8 in declared text resources", async () => {
  await assert.rejects(
    serializePromptAttachments(
      [
        new File([new Uint8Array([0xc3, 0x28])], "notes.txt", {
          type: "text/plain",
        }),
      ],
      allPromptCapabilities,
    ),
    /notes\.txt is not valid UTF-8 text\./,
  );
});
