import { randomUUID } from "node:crypto";

import { and, eq, isNull, sql, type SQL } from "drizzle-orm";

import type { RadiusDatabase } from "./database.js";
import {
  clientInstances,
  composerDrafts,
  projects,
  sessions,
} from "./schema.js";

export const MAX_COMPOSER_DRAFT_LENGTH = 100_000;

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
  database: RadiusDatabase,
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
  if (input.content.length === 0) {
    await clearComposerDraft(database, input);
    return;
  }
  if (input.content.length > MAX_COMPOSER_DRAFT_LENGTH) {
    throw new Error(
      `Drafts must be ${MAX_COMPOSER_DRAFT_LENGTH} characters or fewer`,
    );
  }
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new Error("Draft timestamp must be a positive integer");
  }

  await assertWritableContext(database, input);
  const insert = database.db.insert(composerDrafts).values({
    id: randomUUID(),
    clientInstanceId: input.clientInstanceId,
    kind: input.context.kind,
    projectId:
      input.context.kind === "new_chat" ? input.context.projectId : null,
    sessionId:
      input.context.kind === "session" ? input.context.sessionId : null,
    content: input.content,
    createdAtMs: now,
    updatedAtMs: now,
  });
  const set = { content: input.content, updatedAtMs: now };
  if (input.context.kind === "session") {
    await insert.onConflictDoUpdate({
      target: [composerDrafts.clientInstanceId, composerDrafts.sessionId],
      targetWhere: sql`${composerDrafts.kind} = 'session'`,
      set,
    });
  } else if (input.context.projectId !== null) {
    await insert.onConflictDoUpdate({
      target: [composerDrafts.clientInstanceId, composerDrafts.projectId],
      targetWhere: sql`${composerDrafts.kind} = 'new_chat' and ${composerDrafts.projectId} is not null`,
      set,
    });
  } else {
    await insert.onConflictDoUpdate({
      target: [composerDrafts.clientInstanceId, composerDrafts.kind],
      targetWhere: sql`${composerDrafts.kind} = 'new_chat' and ${composerDrafts.projectId} is null`,
      set,
    });
  }
}
