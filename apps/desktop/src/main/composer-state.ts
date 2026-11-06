import { createHash, randomUUID } from "node:crypto";
import { open, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import {
  addComposerDraftAttachments,
  listComposerDraftAttachments,
  removeComposerDraftAttachment,
  getComposerAccessMode,
  clearComposerDraft,
  isComposerAttachmentPathReferenced,
  type ComposerDraftAttachment,
  type ComposerDraftContext,
} from "@curve-ai/radius-storage";
import { resolveLocalArtifactPath } from "@curve-ai/radius-sync-core";
import type {
  AccessMode,
  ComposerAttachment,
  ComposerState,
  ComposerStateChange,
  PromptAttachment,
} from "../radius-api";
import {
  parseComposerDraftContext,
  localDraftStorage,
} from "./composer-drafts";
import {
  parsePromptAttachments,
  validatePromptAttachments,
} from "./prompt-attachments";
import { writeContentAddressedFile } from "./content-addressed-file";
import { withComposerMutation } from "./composer-mutations";
import { updateSessionAccessModeForDesktop } from "./runtime-session-journal";

function notify(change: ComposerStateChange): void {
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send("radius:composer-state-changed", change);
}
const root = (): string => path.join(app.getPath("userData"), "artifacts");

async function readAttachment(
  row: ComposerDraftAttachment,
): Promise<ComposerAttachment> {
  const filePath = await resolveLocalArtifactPath(
    root(),
    row.localRelativePath,
  );
  const file = await open(filePath, "r");
  try {
    if (
      (await file.stat()).size !== row.byteSize ||
      row.byteSize > 25 * 1024 * 1024
    )
      throw new Error("The saved attachment has changed");
    const bytes = Buffer.alloc(row.byteSize + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await file.read(bytes, size, bytes.length - size, size);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    const content = bytes.subarray(0, size);
    if (
      size !== row.byteSize ||
      createHash("sha256").update(content).digest("hex") !== row.contentSha256
    )
      throw new Error("The saved attachment has changed");
    return {
      id: row.id,
      name: row.name,
      mimeType: row.mimeType,
      lastModified: row.lastModified,
      bytes: new Uint8Array(content),
    };
  } finally {
    await file.close();
  }
}

export async function getComposerAccessModeForRenderer(
  value: unknown,
): Promise<AccessMode> {
  const context = parseComposerDraftContext(value);
  const { database, input } = await localDraftStorage(context);
  return getComposerAccessMode(
    database,
    input.clientInstanceId,
    context.kind === "session" ? context.sessionId : null,
  );
}

export async function getComposerStateForRenderer(
  value: unknown,
): Promise<ComposerState> {
  const context = parseComposerDraftContext(value);
  return withComposerMutation(async () => {
    const { database, input } = await localDraftStorage(context);
    return {
      accessMode: await getComposerAccessMode(
        database,
        input.clientInstanceId,
        context.kind === "session" ? context.sessionId : null,
      ),
      attachments: await Promise.all(
        (await listComposerDraftAttachments(database, input)).map(
          readAttachment,
        ),
      ),
    };
  });
}

export async function setComposerAccessModeForRenderer(value: {
  context: unknown;
  mode: unknown;
}): Promise<void> {
  const context = parseComposerDraftContext(value?.context);
  if (value.mode !== "ask" && value.mode !== "project" && value.mode !== "full")
    throw new Error("Invalid access mode");
  const accessMode = value.mode;
  await withComposerMutation(async () => {
    const { database, input } = await localDraftStorage(context);
    await updateSessionAccessModeForDesktop(
      database,
      input.clientInstanceId,
      context.kind === "session" ? context.sessionId : null,
      accessMode,
    );
    notify({
      kind: "access",
      sessionId: context.kind === "session" ? context.sessionId : null,
    });
  });
}

async function reclaim(
  context: ComposerDraftContext,
  paths: string[],
): Promise<void> {
  const { database } = await localDraftStorage(context);
  for (const relative of new Set(paths)) {
    // Draft bytes have their own namespace; submitted artifacts use sha256/.
    if (
      !relative.startsWith("drafts/") ||
      (await isComposerAttachmentPathReferenced(database, relative))
    )
      continue;
    try {
      await unlink(await resolveLocalArtifactPath(root(), relative));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.error("[drafts] Unused attachment cleanup failed", error);
    }
  }
}

export async function addComposerAttachmentsForRenderer(value: {
  context: unknown;
  files: unknown;
}): Promise<void> {
  const context = parseComposerDraftContext(value?.context);
  if (!Array.isArray(value.files) || value.files.length > 10)
    throw new Error("Invalid attachments");
  const files = value.files;
  const parsed = parsePromptAttachments(files.map((file) => file?.attachment));
  const validated = validatePromptAttachments(parsed, {
    image: true,
    audio: true,
    embeddedContext: true,
  });
  const modified = files.map((file) => file?.lastModified);
  if (modified.some((time) => !Number.isSafeInteger(time) || time < 0))
    throw new Error("Invalid file modification time");
  await withComposerMutation(async () => {
    const { database, input } = await localDraftStorage(context);
    const paths: string[] = [];
    try {
      const attachments = await Promise.all(
        validated.map(async (file, index) => {
          const contentSha256 = createHash("sha256")
            .update(file.bytes)
            .digest("hex");
          const localRelativePath = `drafts/${contentSha256.slice(0, 2)}/${contentSha256}`;
          paths.push(localRelativePath);
          await writeContentAddressedFile({
            bytes: file.bytes,
            contentSha256,
            targetPath: path.join(root(), localRelativePath),
            conflictCode: "DRAFT_ATTACHMENT_STORE_CONFLICT",
          });
          return {
            id: randomUUID(),
            name: file.name,
            mimeType: file.mimeType,
            byteSize: file.bytes.byteLength,
            contentSha256,
            localRelativePath,
            lastModified: modified[index],
          };
        }),
      );
      await addComposerDraftAttachments(database, { ...input, attachments });
    } catch (error) {
      await reclaim(context, paths);
      throw error;
    }
    notify({ kind: "attachments", context });
  });
}

export async function removeComposerAttachmentForRenderer(value: {
  context: unknown;
  attachmentId: unknown;
}): Promise<void> {
  const context = parseComposerDraftContext(value?.context);
  if (typeof value.attachmentId !== "string")
    throw new Error("Invalid attachment");
  const attachmentId = value.attachmentId;
  await withComposerMutation(async () => {
    const { database, input } = await localDraftStorage(context);
    const rows = await listComposerDraftAttachments(database, input);
    await removeComposerDraftAttachment(database, { ...input, attachmentId });
    await reclaim(
      context,
      rows.map((row) => row.localRelativePath),
    );
    notify({ kind: "attachments", context });
  });
}

export async function clearAcceptedComposerDraft(
  context: ComposerDraftContext,
): Promise<void> {
  await withComposerMutation(async () => {
    const { database, input } = await localDraftStorage(context);
    const rows = await listComposerDraftAttachments(database, input);
    await clearComposerDraft(database, input);
    await reclaim(
      context,
      rows.map((row) => row.localRelativePath),
    );
    notify({ kind: "attachments", context });
  });
}

/** Reclaims interrupted imports and bytes left after cascaded draft deletion. */
export async function cleanupUnusedComposerAttachments(): Promise<void> {
  await withComposerMutation(async () => {
    let prefixes;
    try {
      prefixes = await readdir(path.join(root(), "drafts"), {
        withFileTypes: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const prefix of prefixes) {
      if (!prefix.isDirectory() || !/^[0-9a-f]{2}$/.test(prefix.name)) continue;
      const files = await readdir(path.join(root(), "drafts", prefix.name), {
        withFileTypes: true,
      });
      await reclaim(
        { kind: "new_chat", projectId: null },
        files
          .filter((file) => file.isFile() && /^[0-9a-f]{64}$/.test(file.name))
          .map((file) => `drafts/${prefix.name}/${file.name}`),
      );
    }
  });
}

export async function resolveComposerPromptAttachments(
  context: ComposerDraftContext,
  ids: string[],
): Promise<PromptAttachment[]> {
  if (
    ids.length > 10 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== "string")
  )
    throw new Error("Invalid attachment selection");
  return withComposerMutation(async () => {
    const { database, input } = await localDraftStorage(context);
    const rows = await listComposerDraftAttachments(database, input);
    return Promise.all(
      ids.map(async (id, index): Promise<PromptAttachment> => {
        const row = rows.find((row) => row.id === id);
        if (!row) throw new Error("This attachment is no longer in the draft");
        const file = await readAttachment(row);
        const data = Buffer.from(file.bytes).toString("base64");
        if (
          [
            "image/avif",
            "image/gif",
            "image/jpeg",
            "image/png",
            "image/webp",
          ].includes(row.mimeType)
        )
          return {
            type: "image",
            name: row.name,
            mimeType: row.mimeType,
            data,
          };
        if (row.mimeType.startsWith("audio/"))
          return {
            type: "audio",
            name: row.name,
            mimeType: row.mimeType,
            data,
          };
        const uri = `radius-attachment:///prompt/${index + 1}/${encodeURIComponent(row.name)}`;
        const text =
          row.mimeType.startsWith("text/") ||
          /(?:json|xml|yaml|toml)$/.test(row.mimeType);
        return {
          type: "resource",
          name: row.name,
          resource: text
            ? {
                uri,
                mimeType: row.mimeType,
                text: new TextDecoder("utf-8", { fatal: true }).decode(
                  file.bytes,
                ),
              }
            : { uri, mimeType: row.mimeType, blob: data },
        };
      }),
    );
  });
}
