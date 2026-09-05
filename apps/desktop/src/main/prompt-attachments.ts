import type {
  ContentBlock,
  PromptCapabilities,
} from "@agentclientprotocol/sdk";

import {
  MAX_PROMPT_ATTACHMENT_COUNT,
  MAX_PROMPT_ATTACHMENT_TOTAL_BYTES,
  MAX_PROMPT_AUDIO_BYTES,
  MAX_PROMPT_IMAGE_BYTES,
  MAX_PROMPT_RESOURCE_BYTES,
  type PromptAttachment,
} from "../radius-api";
import {
  RADIUS_IMAGE_CONTENT_TYPES,
  radiusImageMatchesSignature,
} from "./image-content";

export interface ValidatedPromptAttachment {
  artifactType: "image" | "other" | "document";
  bytes: Buffer;
  content: ContentBlock;
  mimeType: string;
  name: string;
}

export function parsePromptAttachments(value: unknown): PromptAttachment[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_PROMPT_ATTACHMENT_COUNT) {
    throw new Error("PROMPT_ATTACHMENTS_INVALID");
  }
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("PROMPT_ATTACHMENT_INVALID");
    }
    const attachment = candidate as Record<string, unknown>;
    if (
      typeof attachment.name !== "string" ||
      (attachment.type !== "image" &&
        attachment.type !== "audio" &&
        attachment.type !== "resource")
    ) {
      throw new Error("PROMPT_ATTACHMENT_INVALID");
    }
    if (attachment.type === "image" || attachment.type === "audio") {
      if (
        typeof attachment.mimeType !== "string" ||
        typeof attachment.data !== "string"
      ) {
        throw new Error("PROMPT_ATTACHMENT_INVALID");
      }
      return {
        type: attachment.type,
        name: attachment.name,
        mimeType: attachment.mimeType,
        data: attachment.data,
      };
    }
    if (!attachment.resource || typeof attachment.resource !== "object") {
      throw new Error("PROMPT_ATTACHMENT_INVALID");
    }
    const resource = attachment.resource as Record<string, unknown>;
    if (
      typeof resource.uri !== "string" ||
      typeof resource.mimeType !== "string" ||
      !(
        (typeof resource.text === "string" && resource.blob === undefined) ||
        (typeof resource.blob === "string" && resource.text === undefined)
      )
    ) {
      throw new Error("PROMPT_ATTACHMENT_INVALID");
    }
    return {
      type: "resource",
      name: attachment.name,
      resource:
        typeof resource.text === "string"
          ? {
              uri: resource.uri,
              mimeType: resource.mimeType,
              text: resource.text,
            }
          : {
              uri: resource.uri,
              mimeType: resource.mimeType,
              blob: resource.blob as string,
            },
    };
  });
}

function safeName(value: string): string {
  const leaf = value.split(/[/\\]/).at(-1)?.trim() ?? "";
  const normalized = Array.from(leaf, (character) =>
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      ? " "
      : character,
  )
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255);
  if (!normalized) throw new Error("PROMPT_ATTACHMENT_NAME_INVALID");
  return normalized;
}

function validMimeType(value: string): string {
  const mimeType = value.trim().toLowerCase();
  if (
    !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mimeType)
  ) {
    throw new Error("PROMPT_ATTACHMENT_MIME_INVALID");
  }
  return mimeType;
}

function decodeBase64(value: string): Buffer {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new Error("PROMPT_ATTACHMENT_DATA_INVALID");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength === 0 || bytes.toString("base64") !== value) {
    throw new Error("PROMPT_ATTACHMENT_DATA_INVALID");
  }
  return bytes;
}

function assertLimit(bytes: Buffer, limit: number): void {
  if (bytes.byteLength > limit) {
    throw new Error("PROMPT_ATTACHMENT_TOO_LARGE");
  }
}

function assertCapability(
  supported: boolean | null | undefined,
  code: string,
): void {
  if (supported !== true) throw new Error(code);
}

function validateResourceUri(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PROMPT_ATTACHMENT_URI_INVALID");
  }
  if (url.protocol !== "radius-attachment:") {
    throw new Error("PROMPT_ATTACHMENT_URI_INVALID");
  }
  return url.href;
}

export function validatePromptAttachments(
  attachments: readonly PromptAttachment[],
  capabilities: PromptCapabilities | null | undefined,
): ValidatedPromptAttachment[] {
  if (attachments.length > MAX_PROMPT_ATTACHMENT_COUNT) {
    throw new Error("PROMPT_ATTACHMENT_COUNT_EXCEEDED");
  }

  let totalBytes = 0;
  return attachments.map((attachment) => {
    const name = safeName(attachment.name);
    if (attachment.type === "image") {
      assertCapability(capabilities?.image, "PROMPT_IMAGE_CAPABILITY_REQUIRED");
      const mimeType = validMimeType(attachment.mimeType);
      if (!RADIUS_IMAGE_CONTENT_TYPES.has(mimeType)) {
        throw new Error("PROMPT_IMAGE_MIME_UNSUPPORTED");
      }
      const bytes = decodeBase64(attachment.data);
      assertLimit(bytes, MAX_PROMPT_IMAGE_BYTES);
      if (!radiusImageMatchesSignature(mimeType, bytes)) {
        throw new Error("PROMPT_IMAGE_CONTENT_INVALID");
      }
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_PROMPT_ATTACHMENT_TOTAL_BYTES) {
        throw new Error("PROMPT_ATTACHMENT_TOTAL_TOO_LARGE");
      }
      return {
        artifactType: "image",
        bytes,
        content: { type: "image", data: attachment.data, mimeType },
        mimeType,
        name,
      };
    }

    if (attachment.type === "audio") {
      assertCapability(capabilities?.audio, "PROMPT_AUDIO_CAPABILITY_REQUIRED");
      const mimeType = validMimeType(attachment.mimeType);
      if (!mimeType.startsWith("audio/")) {
        throw new Error("PROMPT_AUDIO_MIME_UNSUPPORTED");
      }
      const bytes = decodeBase64(attachment.data);
      assertLimit(bytes, MAX_PROMPT_AUDIO_BYTES);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_PROMPT_ATTACHMENT_TOTAL_BYTES) {
        throw new Error("PROMPT_ATTACHMENT_TOTAL_TOO_LARGE");
      }
      return {
        artifactType: "other",
        bytes,
        content: { type: "audio", data: attachment.data, mimeType },
        mimeType,
        name,
      };
    }

    assertCapability(
      capabilities?.embeddedContext,
      "PROMPT_RESOURCE_CAPABILITY_REQUIRED",
    );
    const uri = validateResourceUri(attachment.resource.uri);
    const mimeType = validMimeType(attachment.resource.mimeType);
    const bytes =
      "text" in attachment.resource
        ? Buffer.from(attachment.resource.text, "utf8")
        : decodeBase64(attachment.resource.blob);
    assertLimit(bytes, MAX_PROMPT_RESOURCE_BYTES);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_PROMPT_ATTACHMENT_TOTAL_BYTES) {
      throw new Error("PROMPT_ATTACHMENT_TOTAL_TOO_LARGE");
    }
    return {
      artifactType: "document",
      bytes,
      content: {
        type: "resource",
        resource:
          "text" in attachment.resource
            ? { uri, mimeType, text: attachment.resource.text }
            : { uri, mimeType, blob: attachment.resource.blob },
      },
      mimeType,
      name,
    };
  });
}

export function assertPromptAttachmentCapabilities(
  attachments: readonly ValidatedPromptAttachment[],
  capabilities: PromptCapabilities | null | undefined,
): void {
  for (const attachment of attachments) {
    if (attachment.content.type === "image") {
      assertCapability(capabilities?.image, "PROMPT_IMAGE_CAPABILITY_REQUIRED");
    } else if (attachment.content.type === "audio") {
      assertCapability(capabilities?.audio, "PROMPT_AUDIO_CAPABILITY_REQUIRED");
    } else {
      assertCapability(
        capabilities?.embeddedContext,
        "PROMPT_RESOURCE_CAPABILITY_REQUIRED",
      );
    }
  }
}
