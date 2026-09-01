import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { count, eq } from "drizzle-orm";

import {
  clearComposerDraft,
  getComposerDraft,
  MAX_COMPOSER_DRAFT_LENGTH,
  saveComposerDraft,
} from "./composer-draft-store.js";
import { migrateRadiusDatabase, openRadiusDatabase } from "./database.js";
import {
  clientInstances,
  composerDrafts,
  localChanges,
  sessions,
} from "./schema.js";
import { createProject, createSession, setSessionArchived } from "./store.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const clientInstanceId = "9330311e-b3e6-4d14-939d-ec7082834078";

async function removeTemporaryDirectory(directory: string): Promise<void> {
  try {
    await rm(directory, { force: true, recursive: true });
  } catch (error) {
    if (
      process.platform === "win32" &&
      (error as NodeJS.ErrnoException).code === "EBUSY"
    ) {
      return;
    }
    throw error;
  }
}

async function withDatabase(
  callback: (
    database: Awaited<ReturnType<typeof openRadiusDatabase>>,
  ) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "radius-drafts-"));
  const database = await openRadiusDatabase({
    path: path.join(directory, "radius.db"),
  });
  try {
    await migrateRadiusDatabase(database, migrationsFolder);
    const now = Date.parse("2026-08-31T12:00:00.000Z");
    await database.db.insert(clientInstances).values({
      id: clientInstanceId,
      displayName: "Draft Test Mac",
      platform: "darwin",
      publicKeyJwk: "{}",
      isLocal: true,
      createdAtMs: now,
      updatedAtMs: now,
    });
    await callback(database);
  } finally {
    database.close();
    await removeTemporaryDirectory(directory);
  }
}

test("keeps standalone, project, and session composer drafts isolated", async () => {
  await withDatabase(async (database) => {
    const project = await createProject(database, {
      originClientInstanceId: clientInstanceId,
      name: "Draft project",
    });
    const session = await createSession(database, {
      originClientInstanceId: clientInstanceId,
      projectId: project.id,
      title: "Draft session",
    });
    const contexts = [
      {
        context: { kind: "new_chat" as const, projectId: null },
        content: "Standalone",
      },
      {
        context: { kind: "new_chat" as const, projectId: project.id },
        content: "Project prompt",
      },
      {
        context: { kind: "session" as const, sessionId: session.id },
        content: "Session follow-up",
      },
    ];
    const [syncCountBefore] = await database.db
      .select({ value: count() })
      .from(localChanges);

    for (const draft of contexts) {
      await saveComposerDraft(database, {
        clientInstanceId,
        ...draft,
      });
    }
    for (const draft of contexts) {
      assert.equal(
        await getComposerDraft(database, {
          clientInstanceId,
          context: draft.context,
        }),
        draft.content,
      );
    }

    const [draftCount] = await database.db
      .select({ value: count() })
      .from(composerDrafts);
    assert.equal(draftCount?.value, 3);
    const [syncCount] = await database.db
      .select({ value: count() })
      .from(localChanges);
    assert.equal(syncCount?.value, syncCountBefore?.value);
  });
});

test("updates exact content and removes empty or explicitly cleared drafts", async () => {
  await withDatabase(async (database) => {
    const context = { kind: "new_chat" as const, projectId: null };
    await saveComposerDraft(database, {
      clientInstanceId,
      context,
      content: "  preserve whitespace  ",
      now: Date.parse("2026-08-31T12:01:00.000Z"),
    });
    await saveComposerDraft(database, {
      clientInstanceId,
      context,
      content: "latest",
      now: Date.parse("2026-08-31T12:02:00.000Z"),
    });
    assert.equal(
      await getComposerDraft(database, { clientInstanceId, context }),
      "latest",
    );

    await saveComposerDraft(database, {
      clientInstanceId,
      context,
      content: "",
    });
    assert.equal(
      await getComposerDraft(database, { clientInstanceId, context }),
      null,
    );

    await saveComposerDraft(database, {
      clientInstanceId,
      context,
      content: "again",
    });
    await clearComposerDraft(database, { clientInstanceId, context });
    assert.equal(
      await getComposerDraft(database, { clientInstanceId, context }),
      null,
    );
  });
});

test("validates draft size and parent contexts", async () => {
  await withDatabase(async (database) => {
    await assert.rejects(
      saveComposerDraft(database, {
        clientInstanceId,
        context: { kind: "new_chat", projectId: null },
        content: "x".repeat(MAX_COMPOSER_DRAFT_LENGTH + 1),
      }),
      /characters or fewer/,
    );
    await assert.rejects(
      saveComposerDraft(database, {
        clientInstanceId,
        context: { kind: "session", sessionId: "missing-session" },
        content: "Cannot attach to a missing session",
      }),
      /session does not exist/,
    );
  });
});

test("deleting a session cascades its local composer draft", async () => {
  await withDatabase(async (database) => {
    const sessionId = "ed085382-08aa-4480-80b4-e1a672292f44";
    const now = Date.parse("2026-08-31T12:03:00.000Z");
    await database.db.insert(sessions).values({
      id: sessionId,
      originClientInstanceId: clientInstanceId,
      projectId: null,
      title: "Temporary session",
      status: "active",
      revision: 1,
      createdAtMs: now,
      updatedAtMs: now,
    });
    await saveComposerDraft(database, {
      clientInstanceId,
      context: { kind: "session", sessionId },
      content: "Temporary draft",
    });

    await database.db.delete(sessions).where(eq(sessions.id, sessionId));
    assert.equal(
      await getComposerDraft(database, {
        clientInstanceId,
        context: { kind: "session", sessionId },
      }),
      null,
    );
  });
});

test("archiving a session removes its device-local composer draft", async () => {
  await withDatabase(async (database) => {
    const session = await createSession(database, {
      originClientInstanceId: clientInstanceId,
      title: "Archived session",
    });
    const context = { kind: "session" as const, sessionId: session.id };
    await saveComposerDraft(database, {
      clientInstanceId,
      context,
      content: "Do not retain after archive",
    });

    await setSessionArchived(database, {
      originClientInstanceId: clientInstanceId,
      sessionId: session.id,
    });
    assert.equal(
      await getComposerDraft(database, { clientInstanceId, context }),
      null,
    );
  });
});
