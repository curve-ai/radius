import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPromptAttachmentCapabilities,
  parsePromptAttachments,
  validatePromptAttachments,
} from "./prompt-attachments";

test("validates prompt images and embedded text into ACP content", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const attachments = validatePromptAttachments(
    [
      {
        type: "image",
        name: "chart.png",
        mimeType: "image/png",
        data: png.toString("base64"),
      },
      {
        type: "resource",
        name: "notes.md",
        resource: {
          uri: "radius-attachment:///prompt/2/notes.md",
          mimeType: "text/markdown",
          text: "# Notes",
        },
      },
    ],
    { image: true, audio: false, embeddedContext: true },
  );

  assert.equal(attachments[0]?.artifactType, "image");
  assert.deepEqual(attachments[0]?.content, {
    type: "image",
    data: png.toString("base64"),
    mimeType: "image/png",
  });
  assert.equal(attachments[1]?.artifactType, "document");
  assert.deepEqual(attachments[1]?.content, {
    type: "resource",
    resource: {
      uri: "radius-attachment:///prompt/2/notes.md",
      mimeType: "text/markdown",
      text: "# Notes",
    },
  });
});

test("requires live ACP prompt capabilities and canonical base64", () => {
  assert.throws(
    () =>
      validatePromptAttachments(
        [
          {
            type: "audio",
            name: "note.wav",
            mimeType: "audio/wav",
            data: Buffer.from("audio").toString("base64"),
          },
        ],
        { image: true, audio: false, embeddedContext: true },
      ),
    /PROMPT_AUDIO_CAPABILITY_REQUIRED/,
  );
  assert.throws(
    () =>
      validatePromptAttachments(
        [
          {
            type: "image",
            name: "chart.png",
            mimeType: "image/png",
            data: "not base64",
          },
        ],
        { image: true, audio: false, embeddedContext: false },
      ),
    /PROMPT_ATTACHMENT_DATA_INVALID/,
  );
});

test("can defer capability checks until after ACP initialization", () => {
  const attachments = validatePromptAttachments(
    [
      {
        type: "audio",
        name: "note.wav",
        mimeType: "audio/wav",
        data: Buffer.from("audio").toString("base64"),
      },
    ],
    { image: true, audio: true, embeddedContext: true },
  );
  assert.throws(
    () =>
      assertPromptAttachmentCapabilities(attachments, {
        image: true,
        audio: false,
        embeddedContext: true,
      }),
    /PROMPT_AUDIO_CAPABILITY_REQUIRED/,
  );
});

test("rejects renderer-authored file paths and traversal names", () => {
  assert.throws(
    () =>
      validatePromptAttachments(
        [
          {
            type: "resource",
            name: "../notes.txt",
            resource: {
              uri: "file:///Users/example/notes.txt",
              mimeType: "text/plain",
              text: "notes",
            },
          },
        ],
        { image: false, audio: false, embeddedContext: true },
      ),
    /PROMPT_ATTACHMENT_URI_INVALID/,
  );
});

test("rejects malformed IPC attachment payloads before decoding", () => {
  assert.throws(
    () => parsePromptAttachments([{ type: "image", name: "x.png" }]),
    /PROMPT_ATTACHMENT_INVALID/,
  );
  assert.throws(
    () =>
      parsePromptAttachments([
        {
          type: "resource",
          name: "x.txt",
          resource: {
            uri: "radius-attachment:///prompt/1/x.txt",
            mimeType: "text/plain",
            text: "x",
            blob: "eA==",
          },
        },
      ]),
    /PROMPT_ATTACHMENT_INVALID/,
  );
});
