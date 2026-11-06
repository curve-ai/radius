import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import {
  SyncChangeEnvelopeSchema,
  type JsonValue,
} from "@curve-ai/radius-sync-protocol";
import { canonicalJson, sha256Hex } from "./canonical-json.js";
import {
  migrateRadiusDatabase,
  openRadiusDatabase,
  type RadiusDatabase,
} from "./database.js";
import {
  createSession,
  getComposerAccessMode,
  setSessionAccessModeAndDefault,
  updateSessionTitle,
  configureSyncConnection,
  applyRemoteChange,
} from "./store.js";
import {
  addComposerDraftAttachments,
  listComposerDraftAttachments,
  removeComposerDraftAttachment,
  saveComposerDraft,
  getComposerDraft,
  clearComposerDraft,
} from "./composer-draft-store.js";
import {
  clientInstances,
  composerDraftAttachments,
  localChanges,
} from "./schema.js";

const migrations = fileURLToPath(new URL("../drizzle", import.meta.url));
const clientId = "9330311e-b3e6-4d14-939d-ec7082834078";
async function withDatabase(
  run: (database: RadiusDatabase, file: string) => Promise<void>,
) {
  const folder = await mkdtemp(path.join(tmpdir(), "radius-composer-"));
  const file = path.join(folder, "radius.db");
  const database = await openRadiusDatabase({ path: file });
  try {
    await migrateRadiusDatabase(database, migrations);
    await database.db.insert(clientInstances).values({
      id: clientId,
      displayName: "Test",
      platform: "darwin",
      publicKeyJwk: "{}",
      isLocal: true,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    });
    await run(database, file);
  } finally {
    database.close();
    await rm(folder, { recursive: true, force: true });
  }
}
const file = (name = "notes.txt") => ({
  id: randomUUID(),
  name,
  mimeType: "text/plain",
  byteSize: 3,
  contentSha256: "a".repeat(64),
  localRelativePath: "drafts/aa/" + "a".repeat(64),
  lastModified: 123,
});

test("session modes persist independently and new sessions copy the shared default", async () => {
  await withDatabase(async (database, dbPath) => {
    const first = await createSession(database, {
      originClientInstanceId: clientId,
      title: "A",
    });
    const second = await createSession(database, {
      originClientInstanceId: clientId,
      title: "B",
    });
    await setSessionAccessModeAndDefault(database, {
      clientInstanceId: clientId,
      sessionId: first.id,
      accessMode: "ask",
    });
    assert.equal(await getComposerAccessMode(database, clientId), "ask");
    assert.equal(
      await getComposerAccessMode(database, clientId, second.id),
      "project",
    );
    const third = await createSession(database, {
      originClientInstanceId: clientId,
      title: "C",
    });
    assert.equal(third.accessMode, "ask");
    await setSessionAccessModeAndDefault(database, {
      clientInstanceId: clientId,
      sessionId: second.id,
      accessMode: "full",
    });
    assert.equal(
      await getComposerAccessMode(database, clientId, first.id),
      "ask",
    );
    assert.equal(await getComposerAccessMode(database, clientId), "full");
    const renamed = await updateSessionTitle(database, {
      originClientInstanceId: clientId,
      sessionId: first.id,
      title: "Renamed",
    });
    assert.equal(renamed.accessMode, "ask");
    const change = (
      await database.db
        .select()
        .from(localChanges)
        .where(eq(localChanges.sessionId, first.id))
    ).at(-1)!;
    assert.equal(JSON.parse(change.payloadJson).accessMode, "ask");
    await assert.rejects(
      setSessionAccessModeAndDefault(database, {
        clientInstanceId: clientId,
        sessionId: randomUUID(),
        accessMode: "project",
      }),
    );
    assert.equal(
      await getComposerAccessMode(database, clientId),
      "full",
      "failed session update must not change the default",
    );
    const reopened = await openRadiusDatabase({ path: dbPath });
    try {
      assert.equal(
        await getComposerAccessMode(reopened, clientId, first.id),
        "ask",
      );
      assert.equal(await getComposerAccessMode(reopened, clientId), "full");
    } finally {
      reopened.close();
    }
  });
});

test("attachment-only drafts retain files through text edits, isolate contexts, and cascade on clear", async () => {
  await withDatabase(async (database, dbPath) => {
    const session = await createSession(database, {
      originClientInstanceId: clientId,
      title: "Files",
    });
    const input = {
      clientInstanceId: clientId,
      context: { kind: "session" as const, sessionId: session.id },
    };
    const first = file();
    const second = file("other.txt");
    await addComposerDraftAttachments(database, {
      ...input,
      attachments: [first, second],
    });
    assert.equal(await getComposerDraft(database, input), "");
    await saveComposerDraft(database, { ...input, content: "Edit" });
    await saveComposerDraft(database, { ...input, content: "" });
    assert.equal(
      (await listComposerDraftAttachments(database, input)).length,
      2,
    );
    assert.equal(
      (
        await listComposerDraftAttachments(database, {
          clientInstanceId: clientId,
          context: { kind: "new_chat", projectId: null },
        })
      ).length,
      0,
    );
    await removeComposerDraftAttachment(database, {
      ...input,
      attachmentId: first.id,
    });
    assert.deepEqual(
      (await listComposerDraftAttachments(database, input)).map(
        (row) => row.id,
      ),
      [second.id],
    );
    const reopened = await openRadiusDatabase({ path: dbPath });
    try {
      assert.equal(
        (await listComposerDraftAttachments(reopened, input))[0]?.lastModified,
        123,
      );
    } finally {
      reopened.close();
    }
    await clearComposerDraft(database, input);
    assert.equal(
      (await database.db.select().from(composerDraftAttachments)).length,
      0,
    );
    assert.equal(await getComposerDraft(database, input), null);
    await addComposerDraftAttachments(database, {
      ...input,
      attachments: [file()],
    });
    const [last] = await listComposerDraftAttachments(database, input);
    await removeComposerDraftAttachment(database, {
      ...input,
      attachmentId: last.id,
    });
    assert.equal(await getComposerDraft(database, input), null);
    await assert.rejects(
      addComposerDraftAttachments(database, {
        ...input,
        attachments: Array.from({ length: 11 }, () => file()),
      }),
    );
    assert.equal(
      (await listComposerDraftAttachments(database, input)).length,
      0,
    );
  });
});

test("legacy title-only sync updates preserve a previously synchronized session mode", async () => {
  await withDatabase(async (database) => {
    const remote = randomUUID(),
      sessionId = randomUUID(),
      connectionId = randomUUID();
    await configureSyncConnection(database, {
      id: connectionId,
      providerKey: "test",
      endpointUrl: "https://sync.example.test",
      credentialRef: null,
      remoteSubject: null,
      accountLabel: null,
      enabled: false,
    });
    const base = {
      id: sessionId,
      originClientInstanceId: remote,
      projectId: null,
      title: "Remote",
      status: "active" as const,
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null,
      deletedAt: null,
    };
    const apply = async (payload: typeof base & { accessMode?: "ask" }) => {
      const change = SyncChangeEnvelopeSchema.parse({
        protocolVersion: 1,
        changeId: randomUUID(),
        originClientInstanceId: remote,
        sessionId,
        sessionRevision: payload.revision,
        payloadSchemaVersion: 1,
        payloadSha256: sha256Hex(
          canonicalJson(payload as unknown as JsonValue),
        ),
        createdAt: payload.updatedAt,
        kind: "session.upsert",
        payload,
      });
      await applyRemoteChange(database, connectionId, change);
    };
    await apply({ ...base, accessMode: "ask" });
    await apply({ ...base, revision: 2, title: "Legacy rename" });
    assert.equal(
      await getComposerAccessMode(database, clientId, sessionId),
      "ask",
    );
    assert.equal(
      await getComposerAccessMode(database, clientId),
      "project",
      "remote modes do not change the device default",
    );
  });
});

test("upgrade from migration 0014 retains existing drafts and initializes legacy modes", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "radius-composer-upgrade-"));
  const legacy = path.join(folder, "migrations");
  await mkdir(path.join(legacy, "meta"), { recursive: true });
  const journal = JSON.parse(
    await readFile(path.join(migrations, "meta/_journal.json"), "utf8"),
  );
  journal.entries = journal.entries.filter(
    (entry: { idx: number }) => entry.idx <= 14,
  );
  for (const entry of journal.entries)
    await copyFile(
      path.join(migrations, entry.tag + ".sql"),
      path.join(legacy, entry.tag + ".sql"),
    );
  await writeFile(
    path.join(legacy, "meta/_journal.json"),
    JSON.stringify(journal),
  );
  const database = await openRadiusDatabase({
    path: path.join(folder, "old.db"),
  });
  try {
    await migrateRadiusDatabase(database, legacy);
    const now = Date.now();
    await database.client.execute({
      sql: "INSERT INTO client_instances(id,display_name,platform,public_key_jwk,is_local,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?)",
      args: [clientId, "Test", "darwin", "{}", 1, now, now],
    });
    const sessionId = randomUUID();
    await database.client.execute({
      sql: "INSERT INTO sessions(id,origin_client_instance_id,title,status,revision,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?)",
      args: [sessionId, clientId, "Legacy", "active", 1, now, now],
    });
    await database.client.execute({
      sql: "INSERT INTO composer_drafts(id,client_instance_id,kind,session_id,content,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?)",
      args: [randomUUID(), clientId, "session", sessionId, "Keep me", now, now],
    });
    await migrateRadiusDatabase(database, migrations);
    assert.equal(
      await getComposerDraft(database, {
        clientInstanceId: clientId,
        context: { kind: "session", sessionId },
      }),
      "Keep me",
    );
    assert.equal(
      await getComposerAccessMode(database, clientId, sessionId),
      "project",
    );
    assert.equal(
      (await database.client.execute("PRAGMA foreign_key_check")).rows.length,
      0,
    );
  } finally {
    database.close();
    await rm(folder, { recursive: true, force: true });
  }
});
