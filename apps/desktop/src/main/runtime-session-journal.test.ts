import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  clientInstances,
  createSession,
  getSessionRevision,
  listRecentSessions,
  listSessionTranscript,
  migrateRadiusDatabase,
  openRadiusDatabase,
} from "@curve-ai/radius-storage";

import { RuntimeSessionJournal } from "./runtime-session-journal";

const migrationsFolder = fileURLToPath(
  new URL("../../../../packages/storage/drizzle", import.meta.url),
);
const clientId = "30df1ac2-cf38-43fd-a090-d3ee5038a186";

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

test("serializes an agent title between transcript events", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "radius-title-journal-"));
  const database = await openRadiusDatabase({
    path: path.join(directory, "radius.db"),
  });

  try {
    await migrateRadiusDatabase(database, migrationsFolder);
    const now = Date.now();
    await database.db.insert(clientInstances).values({
      id: clientId,
      displayName: "Test Mac",
      platform: "darwin",
      publicKeyJwk: JSON.stringify({ kty: "OKP", crv: "Ed25519", x: "test" }),
      isLocal: true,
      createdAtMs: now,
      updatedAtMs: now,
    });
    const session = await createSession(database, {
      originClientInstanceId: clientId,
      title: "Initial prompt title",
    });
    const journal = new RuntimeSessionJournal(
      database,
      clientId,
      session.id,
      session.revision,
    );
    const agentRunId = "05d80587-bdc8-4676-ab22-c3a1de12713b";

    await journal.append({
      eventId: "fcce2ea8-b294-445a-97c0-cb1d65ce0fe1",
      agentRunId,
      eventType: "agent_run",
      providerKey: "test-agent",
      providerRunId: null,
      triggeringMessageEventId: null,
    });
    await journal.updateTitle("Generated session title");
    await journal.append({
      eventId: "3421d2a4-9505-4352-980e-dc48b2ed3744",
      agentRunId,
      eventType: "agent_run_state_update",
      state: "working",
      detail: null,
    });

    assert.equal(await getSessionRevision(database, session.id), 4);
    assert.equal(
      (await listRecentSessions(database, clientId))[0]?.title,
      "Generated session title",
    );
    assert.deepEqual(
      (await listSessionTranscript(database, session.id)).map(
        (event) => event.eventType,
      ),
      ["agent_run", "agent_run_state_update"],
    );
  } finally {
    database.close();
    await removeTemporaryDirectory(directory);
  }
});

test("recovers the queue and revision after a failed event", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "radius-title-journal-"));
  const database = await openRadiusDatabase({
    path: path.join(directory, "radius.db"),
  });

  try {
    await migrateRadiusDatabase(database, migrationsFolder);
    const now = Date.now();
    await database.db.insert(clientInstances).values({
      id: clientId,
      displayName: "Test Mac",
      platform: "darwin",
      publicKeyJwk: JSON.stringify({ kty: "OKP", crv: "Ed25519", x: "test" }),
      isLocal: true,
      createdAtMs: now,
      updatedAtMs: now,
    });
    const session = await createSession(database, {
      originClientInstanceId: clientId,
      title: "Recover journal",
    });
    const journal = new RuntimeSessionJournal(
      database,
      clientId,
      session.id,
      session.revision,
    );
    const agentRunId = "fa4bd4cf-f4a1-4f77-a5c7-a7e487902cb5";
    const eventId = "d318bc57-201c-43e2-a595-703797d62ebd";

    await journal.append({
      eventId,
      agentRunId,
      eventType: "agent_run",
      providerKey: "test-agent",
      providerRunId: null,
      triggeringMessageEventId: null,
    });
    await assert.rejects(
      journal.append({
        eventId,
        agentRunId,
        eventType: "agent_run_state_update",
        state: "working",
        detail: null,
      }),
    );
    await journal.append({
      eventId: "3dcc7e90-a61e-4441-bdbf-25fa535a363a",
      agentRunId,
      eventType: "agent_run_state_update",
      state: "failed",
      detail: "Recovered",
    });

    assert.equal(await getSessionRevision(database, session.id), 3);
    assert.deepEqual(
      (await listSessionTranscript(database, session.id)).map(
        (event) => event.eventType,
      ),
      ["agent_run", "agent_run_state_update"],
    );
  } finally {
    database.close();
    await removeTemporaryDirectory(directory);
  }
});
