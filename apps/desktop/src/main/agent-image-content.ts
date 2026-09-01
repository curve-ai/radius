import {
  MAX_LOCAL_IMAGE_BYTES,
  radiusImageExtension,
  radiusImageMatchesSignature,
} from "./image-content";

export const MAX_AGENT_IMAGE_BYTES = MAX_LOCAL_IMAGE_BYTES;

export function decodeAgentImage(content: { data: string; mimeType: string }): {
  bytes: Buffer;
  extension: string;
  mimeType: string;
} {
  const mimeType = content.mimeType.trim().toLowerCase();
  const extension = radiusImageExtension(mimeType);
  if (!extension) throw new Error("AGENT_IMAGE_TYPE_UNSUPPORTED");
  const encoded = content.data.replace(/\s/g, "");
  if (
    !encoded ||
    encoded.length > Math.ceil((MAX_AGENT_IMAGE_BYTES * 4) / 3) + 4
  ) {
    throw new Error("AGENT_IMAGE_TOO_LARGE");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_AGENT_IMAGE_BYTES ||
    bytes.toString("base64").replace(/=+$/, "") !==
      encoded.replace(/=+$/, "") ||
    !radiusImageMatchesSignature(mimeType, bytes)
  ) {
    throw new Error("AGENT_IMAGE_INVALID");
  }
  return { bytes, extension, mimeType };
}
