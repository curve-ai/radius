import { randomUUID } from "node:crypto";

import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";

import type { RadiusDatabase } from "./database.js";
import {
  clientInstances,
  composerDrafts,
  composerDraftAttachments,
  projects,
  sessions,
} from "./schema.js";

export const MAX_COMPOSER_DRAFT_LENGTH = 100_000;
export const MAX_DRAFT_ATTACHMENT_COUNT = 10;
export const MAX_DRAFT_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;
type DraftDatabase = {
  db: Pick<RadiusDatabase["db"], "select" | "insert" | "update" | "delete">;
};
export type ComposerDraftAttachment =
  typeof composerDraftAttachments.$inferSelect;
export type NewComposerDraftAttachment = Omit<
  ComposerDraftAttachment,
  "draftId" | "position"
>;

export type ComposerDraftContext =
  | { kind: "new_chat"; projectId: string | null }
  | { kind: "session"; sessionId: string };

export interface ComposerDraftInput {
  clientInstanceId: string;
  context: ComposerDraftContext;
}

export interface SaveComposerDraftInput extends ComposerDraftInput {
  content: string;
  now?: number;
}

function contextCondition(input: ComposerDraftInput): SQL<unknown> {
  const clientCondition = eq(
    composerDrafts.clientInstanceId,
    input.clientInstanceId,
  );
  if (input.context.kind === "session") {
    return and(
      clientCondition,
      eq(composerDrafts.kind, "session"),
      eq(composerDrafts.sessionId, input.context.sessionId),
    )!;
  }
  return and(
    clientCondition,
    eq(composerDrafts.kind, "new_chat"),
    input.context.projectId === null
      ? isNull(composerDrafts.projectId)
      : eq(composerDrafts.projectId, input.context.projectId),
  )!;
}

async function assertWritableContext(
  database: DraftDatabase,
  input: ComposerDraftInput,
): Promise<void> {
  const [localClient] = await database.db
    .select({ id: clientInstances.id })
    .from(clientInstances)
    .where(
      and(
        eq(clientInstances.id, input.clientInstanceId),
        eq(clientInstances.isLocal, true),
      ),
    )
    .limit(1);
  if (!localClient) throw new Error("Drafts must belong to the local client");

  if (input.context.kind === "session") {
    const [session] = await database.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, input.context.sessionId),
          isNull(sessions.archivedAtMs),
          isNull(sessions.deletedAtMs),
        ),
      )
      .limit(1);
    if (!session) throw new Error("Draft session does not exist");
    return;
  }

  if (input.context.projectId === null) return;
  const [project] = await database.db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, input.context.projectId),
        isNull(projects.archivedAtMs),
        isNull(projects.deletedAtMs),
      ),
    )
    .limit(1);
  if (!project) throw new Error("Draft project does not exist");
}

export async function getComposerDraft(
  database: RadiusDatabase,
  input: ComposerDraftInput,
): Promise<string | null> {
  const [row] = await database.db
    .select({ content: composerDrafts.content })
    .from(composerDrafts)
    .where(contextCondition(input))
    .limit(1);
  return row?.content ?? null;
}

export async function clearComposerDraft(
  database: RadiusDatabase,
  input: ComposerDraftInput,
): Promise<void> {
  await database.db.delete(composerDrafts).where(contextCondition(input));
}

export async function saveComposerDraft(
  database: RadiusDatabase,
  input: SaveComposerDraftInput,
): Promise<void> {
  if (input.content.length > MAX_COMPOSER_DRAFT_LENGTH) {
    throw new Error(
      `Drafts must be ${MAX_COMPOSER_DRAFT_LENGTH} characters or fewer`,
    );
  }
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new Error("Draft timestamp must be a positive integer");
  }

  await database.db.transaction(async (tx) => {
    const db = { db: tx };
    await assertWritableContext(db, input);
    if (!input.content) {
      const [row] = await tx
        .select({ id: composerDrafts.id })
        .from(composerDrafts)
        .where(contextCondition(input))
        .limit(1);
      const [attachment] = row
        ? await tx
            .select({ id: composerDraftAttachments.id })
            .from(composerDraftAttachments)
            .where(eq(composerDraftAttachments.draftId, row.id))
            .limit(1)
        : [];
      if (!attachment) {
        await tx.delete(composerDrafts).where(contextCondition(input));
        return;
      }
    }
    await upsertDraft(db, input, now, input.content);
  });
}

async function upsertDraft(
  database: DraftDatabase,
  input: ComposerDraftInput,
  now: number,
  content?: string,
): Promise<string> {
  const insert = database.db.insert(composerDrafts).values({
    id: randomUUID(),
    clientInstanceId: input.clientInstanceId,
    kind: input.context.kind,
    projectId:
      input.context.kind === "new_chat" ? input.context.projectId : null,
    sessionId:
      input.context.kind === "session" ? input.context.sessionId : null,
    content: content ?? "",
    createdAtMs: now,
    updatedAtMs: now,
  });
  const set = {
    ...(content !== undefined ? { content } : {}),
    updatedAtMs: now,
  };
  let result: Array<{ id: string }>;
  if (input.context.kind === "session") {
    result = await insert
      .onConflictDoUpdate({
        target: [composerDrafts.clientInstanceId, composerDrafts.sessionId],
        targetWhere: sql`${composerDrafts.kind} = 'session'`,
        set,
      })
      .returning({ id: composerDrafts.id });
  } else if (input.context.projectId !== null) {
    result = await insert
      .onConflictDoUpdate({
        target: [composerDrafts.clientInstanceId, composerDrafts.projectId],
        targetWhere: sql`${composerDrafts.kind} = 'new_chat' and ${composerDrafts.projectId} is not null`,
        set,
      })
      .returning({ id: composerDrafts.id });
  } else {
    result = await insert
      .onConflictDoUpdate({
        target: [composerDrafts.clientInstanceId, composerDrafts.kind],
        targetWhere: sql`${composerDrafts.kind} = 'new_chat' and ${composerDrafts.projectId} is null`,
        set,
      })
      .returning({ id: composerDrafts.id });
  }
  return result[0]!.id;
}

export async function listComposerDraftAttachments(
  database: DraftDatabase,
  input: ComposerDraftInput,
): Promise<ComposerDraftAttachment[]> {
  const rows = await database.db
    .select({ attachment: composerDraftAttachments })
    .from(composerDraftAttachments)
    .innerJoin(
      composerDrafts,
      eq(composerDrafts.id, composerDraftAttachments.draftId),
    )
    .where(contextCondition(input))
    .orderBy(asc(composerDraftAttachments.position));
  return rows.map((row) => row.attachment);
}

export async function addComposerDraftAttachments(
  database: RadiusDatabase,
  input: ComposerDraftInput & { attachments: NewComposerDraftAttachment[] },
): Promise<void> {
  await database.db.transaction(async (tx) => {
    const db = { db: tx };
    await assertWritableContext(db, input);
    const current = await listComposerDraftAttachments(db, input);
    if (
      current.length + input.attachments.length > MAX_DRAFT_ATTACHMENT_COUNT ||
      [...current, ...input.attachments].reduce(
        (sum, file) => sum + file.byteSize,
        0,
      ) > MAX_DRAFT_ATTACHMENT_TOTAL_BYTES
    )
      throw new Error("Draft attachments exceed the supported limits");
    if (!input.attachments.length) return;
    const draftId = await upsertDraft(db, input, Date.now());
    const position = current.at(-1)?.position ?? -1;
    await tx.insert(composerDraftAttachments).values(
      input.attachments.map((file, index) => ({
        ...file,
        draftId,
        position: position + index + 1,
      })),
    );
  });
}

export async function removeComposerDraftAttachment(
  database: RadiusDatabase,
  input: ComposerDraftInput & { attachmentId: string },
): Promise<void> {
  await database.db.transaction(async (tx) => {
    await assertWritableContext({ db: tx }, input);
    const [row] = await tx
      .select()
      .from(composerDrafts)
      .where(contextCondition(input))
      .limit(1);
    if (!row) return;
    await tx
      .delete(composerDraftAttachments)
      .where(
        and(
          eq(composerDraftAttachments.draftId, row.id),
          eq(composerDraftAttachments.id, input.attachmentId),
        ),
      );
    const [remaining] = await tx
      .select({ id: composerDraftAttachments.id })
      .from(composerDraftAttachments)
      .where(eq(composerDraftAttachments.draftId, row.id))
      .limit(1);
    if (!remaining && !row.content)
      await tx.delete(composerDrafts).where(eq(composerDrafts.id, row.id));
  });
}

/** Used by managed-byte cleanup; sent artifacts may still reference the same bytes. */
export async function isComposerAttachmentPathReferenced(
  database: RadiusDatabase,
  relativePath: string,
): Promise<boolean> {
  const [row] = await database.db
    .select({ id: composerDraftAttachments.id })
    .from(composerDraftAttachments)
    .where(eq(composerDraftAttachments.localRelativePath, relativePath))
    .limit(1);
  return !!row;
}
