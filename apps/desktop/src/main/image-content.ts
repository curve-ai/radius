import { open } from "node:fs/promises";
import path from "node:path";

const IMAGE_MIME_EXTENSIONS = new Map([
  ["image/avif", "avif"],
  ["image/gif", "gif"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export const MAX_LOCAL_IMAGE_BYTES = 10 * 1024 * 1024;
export const RADIUS_IMAGE_CONTENT_TYPES: ReadonlySet<string> = new Set(
  IMAGE_MIME_EXTENSIONS.keys(),
);

export function radiusImageExtension(mimeType: string): string | null {
  return IMAGE_MIME_EXTENSIONS.get(mimeType.trim().toLowerCase()) ?? null;
}

export function radiusImageMimeTypeForPath(filePath: string): string | null {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (!extension) return null;
  for (const [mimeType, candidate] of IMAGE_MIME_EXTENSIONS) {
    if (
      candidate === extension ||
      (candidate === "jpg" && extension === "jpeg")
    ) {
      return mimeType;
    }
  }
  return null;
}

export async function readBoundedImageFile(
  filePath: string,
  maxBytes: number,
): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size === 0) {
      throw new Error("RADIUS_IMAGE_INVALID");
    }
    if (metadata.size > maxBytes) {
      throw new Error("RADIUS_IMAGE_TOO_LARGE");
    }

    const bytes = Buffer.allocUnsafe(metadata.size + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      );
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset > maxBytes) throw new Error("RADIUS_IMAGE_TOO_LARGE");
    if (offset !== metadata.size) throw new Error("RADIUS_IMAGE_CHANGED");
    return bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

export function radiusImageMatchesSignature(
  mimeType: string,
  bytes: Uint8Array,
): boolean {
  if (mimeType === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    );
  }
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/gif") {
    const header = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
    return header === "GIF87a" || header === "GIF89a";
  }
  if (mimeType === "image/webp") {
    return (
      Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
      Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
    );
  }
  if (mimeType === "image/avif") {
    return (
      Buffer.from(bytes.subarray(4, 8)).toString("ascii") === "ftyp" &&
      Buffer.from(bytes.subarray(8, 32)).includes(Buffer.from("avif"))
    );
  }
  return false;
}
