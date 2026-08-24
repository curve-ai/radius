import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";

import { migrateRadiusDatabase, openRadiusDatabase } from "./database.js";
import {
  clientInstances,
  messageParts,
  messages,
  sessionEvents,
  sessions,
} from "./schema.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

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

const ids = {
  client: "19353755-3c5e-4529-b58d-c74dacf7b68d",
  event: "97c9a24c-5f06-4af0-8c7e-8fc31b2e8295",
  part: "bba137bb-ab7e-4661-8569-34a5c51a636d",
  session: "3d3f7df5-1dc4-4564-8f04-124df85a69b1",
};

test("applies the initial migration and enforces typed message parts", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "radius-storage-"));
  const database = await openRadiusDatabase({
    path: path.join(directory, "radius.db"),
  });

  try {
    await migrateRadiusDatabase(database, migrationsFolder);
    const now = Date.now();

    await database.db.insert(clientInstances).values({
      id: ids.client,
      displayName: "Test Mac",
      platform: "darwin",
      publicKeyJwk: JSON.stringify({ kty: "OKP", crv: "Ed25519", x: "test" }),
      isLocal: true,
      createdAtMs: now,
      updatedAtMs: now,
    });
    await database.db.insert(sessions).values({
      id: ids.session,
      originClientInstanceId: ids.client,
      title: "Storage test",
      status: "active",
      revision: 1,
      createdAtMs: now,
      updatedAtMs: now,
    });
    await database.db.insert(sessionEvents).values({
      id: ids.event,
      sessionId: ids.session,
      sessionRevision: 1,
      eventType: "message",
      sourceClientInstanceId: ids.client,
      occurredAtMs: now,
    });
    await database.db.insert(messages).values({
      eventId: ids.event,
      role: "user",
      messageKind: "prompt",
      status: "completed",
    });
    await database.db.insert(messageParts).values({
      id: ids.part,
      messageEventId: ids.event,
      position: 0,
      partType: "text",
      textContent: "Hello",
    });

    const stored = await database.db
      .select()
      .from(messageParts)
      .where(eq(messageParts.id, ids.part));
    assert.equal(stored[0]?.textContent, "Hello");

    await assert.rejects(
      database.db.insert(messageParts).values({
        id: "2e3f0363-bbbc-44f6-ac2b-4a4e7b16d54e",
        messageEventId: ids.event,
        position: 1,
        partType: "text",
        textContent: "invalid",
        artifactId: "c440b00f-e788-4616-8e60-b77d7bab5e1e",
      }),
    );
  } finally {
    database.close();
    await removeTemporaryDirectory(directory);
  }
});
