import { createHash } from "node:crypto";
import path from "node:path";

import { getLocalFileArtifact } from "@curve-ai/radius-storage";
import { resolveLocalArtifactPath } from "@curve-ai/radius-sync-core";
import { app } from "electron";

import type { MarkdownMediaResolution } from "../radius-api";
import { BoundedLru } from "./bounded-lru";
import {
  MAX_LOCAL_IMAGE_BYTES,
  readBoundedImageFile,
  RADIUS_IMAGE_CONTENT_TYPES,
} from "./image-content";
import { initializeStorage } from "./storage";

const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 24;
const imageCache = new BoundedLru<MarkdownMediaResolution>(
  MAX_CACHE_ENTRIES,
  MAX_CACHE_BYTES,
);

function parseArtifactRequest(input: unknown): {
  artifactId: string;
  sessionId: string;
} | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (
    typeof value.sessionId !== "string" ||
    !value.sessionId ||
    typeof value.artifactId !== "string" ||
    !value.artifactId
  ) {
    return null;
  }
  return { artifactId: value.artifactId, sessionId: value.sessionId };
}

export async function resolveSessionArtifactImage(
  input: unknown,
): Promise<MarkdownMediaResolution> {
  const request = parseArtifactRequest(input);
  if (!request) return { state: "blocked", reason: "unsafe_url" };
  const context = await initializeStorage();
  const artifact = await getLocalFileArtifact(
    context.database,
    request.sessionId,
    request.artifactId,
  );
  if (
    !artifact ||
    artifact.artifactType !== "image" ||
    artifact.availability !== "local" ||
    !artifact.localRelativePath
  ) {
    return { state: "unavailable" };
  }
  if (!RADIUS_IMAGE_CONTENT_TYPES.has(artifact.mimeType)) {
    return { state: "blocked", reason: "unsupported_type" };
  }
  if (artifact.byteSize > MAX_LOCAL_IMAGE_BYTES) {
    return { state: "blocked", reason: "too_large" };
  }

  const cached = imageCache.get(artifact.contentSha256);
  if (cached) return cached;

  try {
    const artifactRoot = path.join(app.getPath("userData"), "artifacts");
    const filePath = await resolveLocalArtifactPath(
      artifactRoot,
      artifact.localRelativePath,
    );
    const bytes = await readBoundedImageFile(filePath, MAX_LOCAL_IMAGE_BYTES);
    if (
      bytes.byteLength !== artifact.byteSize ||
      createHash("sha256").update(bytes).digest("hex") !==
        artifact.contentSha256
    ) {
      return { state: "unavailable" };
    }
    const result = {
      state: "ready" as const,
      contentType: artifact.mimeType,
      dataUrl: `data:${artifact.mimeType};base64,${bytes.toString("base64")}`,
      finalUrl: `radius-artifact:${artifact.id}`,
    };
    imageCache.set(artifact.contentSha256, result, result.dataUrl.length);
    return result;
  } catch {
    return { state: "unavailable" };
  }
}
