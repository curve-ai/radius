import type {
  DesktopAgentSummary,
  PromptAttachment,
} from "../../../../radius-api";
import {
  MAX_PROMPT_ATTACHMENT_COUNT,
  MAX_PROMPT_ATTACHMENT_TOTAL_BYTES,
  MAX_PROMPT_AUDIO_BYTES,
  MAX_PROMPT_IMAGE_BYTES,
  MAX_PROMPT_RESOURCE_BYTES,
} from "../../../../radius-api";

const attachmentKeys = new WeakMap<File, string>();

const IMAGE_MIME_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MIME_TYPES_BY_EXTENSION = new Map<string, string>([
  ["aac", "audio/aac"],
  ["avif", "image/avif"],
  ["csv", "text/csv"],
  ["flac", "audio/flac"],
  ["gif", "image/gif"],
  ["htm", "text/html"],
  ["html", "text/html"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["json", "application/json"],
  ["m4a", "audio/mp4"],
  ["md", "text/markdown"],
  ["mp3", "audio/mpeg"],
  ["mp4", "audio/mp4"],
  ["oga", "audio/ogg"],
  ["ogg", "audio/ogg"],
  ["pdf", "application/pdf"],
  ["png", "image/png"],
  ["svg", "image/svg+xml"],
  ["toml", "application/toml"],
  ["tsv", "text/tab-separated-values"],
  ["txt", "text/plain"],
  ["wav", "audio/wav"],
  ["webm", "audio/webm"],
  ["webp", "image/webp"],
  ["xml", "application/xml"],
  ["yaml", "application/yaml"],
  ["yml", "application/yaml"],
] as const);

type PromptCapabilities = DesktopAgentSummary["promptCapabilities"];

export class PromptAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptAttachmentError";
  }
}

function displayBytes(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))} MB`;
}

function safeAttachmentName(name: string): string {
  const leaf = name.split(/[\\/]/).at(-1)?.trim() ?? "";
  const clean = Array.from(leaf)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
    .join("")
    .slice(0, 255);
  return clean || "attachment";
}

function effectiveMimeType(file: File): string {
  const declared = file.type.split(";", 1)[0]?.trim().toLowerCase();
  if (
    declared &&
    /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(declared)
  ) {
    return declared;
  }

  const extension = file.name.split(".").at(-1)?.toLowerCase();
  return (
    (extension && MIME_TYPES_BY_EXTENSION.get(extension)) ||
    "application/octet-stream"
  );
}

function isTextResource(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType.endsWith("+json") ||
    mimeType === "application/toml" ||
    mimeType === "application/xml" ||
    mimeType.endsWith("+xml") ||
    mimeType === "application/yaml"
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)),
    );
  }
  return btoa(chunks.join(""));
}

function assertCapability(
  capabilities: PromptCapabilities,
  capability: keyof NonNullable<PromptCapabilities>,
  label: string,
): void {
  if (capabilities && capabilities[capability] !== true) {
    throw new PromptAttachmentError(
      `The selected agent does not accept ${label} attachments.`,
    );
  }
}

function assertSelectionBounds(files: readonly File[]): void {
  if (files.length > MAX_PROMPT_ATTACHMENT_COUNT) {
    throw new PromptAttachmentError(
      `Attach up to ${MAX_PROMPT_ATTACHMENT_COUNT} files at a time.`,
    );
  }

  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_PROMPT_ATTACHMENT_TOTAL_BYTES) {
    throw new PromptAttachmentError(
      `Attachments can total up to ${displayBytes(MAX_PROMPT_ATTACHMENT_TOTAL_BYTES)}.`,
    );
  }
}

export async function serializePromptAttachments(
  files: readonly File[],
  capabilities?: PromptCapabilities,
): Promise<PromptAttachment[]> {
  assertSelectionBounds(files);
  return Promise.all(
    files.map(async (file, index): Promise<PromptAttachment> => {
      const name = safeAttachmentName(file.name);
      const mimeType = effectiveMimeType(file);
      if (file.size === 0) {
        throw new PromptAttachmentError(`${name} is empty.`);
      }

      let type: PromptAttachment["type"];
      let maxBytes: number;
      if (IMAGE_MIME_TYPES.has(mimeType)) {
        assertCapability(capabilities, "image", "image");
        type = "image";
        maxBytes = MAX_PROMPT_IMAGE_BYTES;
      } else if (mimeType.startsWith("audio/")) {
        assertCapability(capabilities, "audio", "audio");
        type = "audio";
        maxBytes = MAX_PROMPT_AUDIO_BYTES;
      } else {
        assertCapability(capabilities, "embeddedContext", "file");
        type = "resource";
        maxBytes = MAX_PROMPT_RESOURCE_BYTES;
      }

      if (file.size > maxBytes) {
        throw new PromptAttachmentError(
          `${name} is too large. This file type can be up to ${displayBytes(maxBytes)}.`,
        );
      }

      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        throw new PromptAttachmentError(`${name} could not be read.`);
      }
      if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
        throw new PromptAttachmentError(`${name} could not be read safely.`);
      }

      if (type === "image" || type === "audio") {
        return {
          type,
          name,
          mimeType,
          data: bytesToBase64(bytes),
        };
      }

      const uri = `radius-attachment:///prompt/${index + 1}/${encodeURIComponent(name)}`;
      if (isTextResource(mimeType)) {
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          throw new PromptAttachmentError(`${name} is not valid UTF-8 text.`);
        }
        return {
          type: "resource",
          name,
          resource: { uri, mimeType, text },
        };
      }
      return {
        type: "resource",
        name,
        resource: { uri, mimeType, blob: bytesToBase64(bytes) },
      };
    }),
  );
}

export function attachmentFileKey(file: File): string {
  const existingKey = attachmentKeys.get(file);
  if (existingKey) return existingKey;

  const key = `attachment-${crypto.randomUUID()}`;
  attachmentKeys.set(file, key);
  return key;
}

export function appendAttachmentFiles(
  current: File[],
  incoming: readonly File[],
): File[] {
  if (incoming.length === 0) return current;

  const seen = new Set(current);
  const additions = incoming.filter((file) => {
    if (seen.has(file)) return false;
    seen.add(file);
    return true;
  });
  return additions.length > 0 ? [...current, ...additions] : current;
}

export function attachmentFilesFromDataTransfer(
  dataTransfer: DataTransfer,
): File[] {
  const files = Array.from(dataTransfer.files);
  if (files.length > 0) return files;

  return Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

export function dataTransferContainsFiles(dataTransfer: DataTransfer): boolean {
  return (
    Array.from(dataTransfer.types).includes("Files") ||
    Array.from(dataTransfer.items).some((item) => item.kind === "file")
  );
}
