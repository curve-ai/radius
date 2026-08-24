import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ProviderCapabilities,
  PullResponse,
  PushRequest,
  PushResponse,
  SyncChangeEnvelope,
} from "@curve-ai/radius-sync-protocol";
import {
  configureSyncConnection,
  createSession,
  appendSessionEvent,
  ensureClientInstance,
  migrateRadiusDatabase,
  openRadiusDatabase,
  syncCursors,
  syncDeliveries,
  artifactTransfers,
} from "@curve-ai/radius-storage";

import { resolveLocalArtifactPath, SyncEngine } from "./engine.js";
import type { SyncProvider } from "./provider.js";

const migrationsFolder = fileURLToPath(
  new URL("../../storage/drizzle", import.meta.url),
);

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
const clientInstanceId = "19353755-3c5e-4529-b58d-c74dacf7b68d";
const connectionId = "5fa9aa30-7a20-4bba-8921-8bff4b0a159d";

class EchoProvider implements SyncProvider {
  changes: SyncChangeEnvelope[] = [];

  async capabilities(): Promise<ProviderCapabilities> {
    return {
      protocolVersions: [1],
      maxBatchSize: 100,
      artifactTransfer: false,
    };
  }

  async push(request: PushRequest): Promise<PushResponse> {
    this.changes.push(...request.changes);
    return {
      protocolVersion: 1,
      results: request.changes.map((change) => ({
        changeId: change.changeId,
        status: "accepted" as const,
        errorCode: null,
      })),
    };
  }

  async pull(): Promise<PullResponse> {
    return {
      protocolVersion: 1,
      changes: this.changes,
      nextCursor: "cursor-1",
    };
  }
}

class ArtifactProvider extends EchoProvider {
  uploaded = new Map<string, Uint8Array>();

  override async capabilities(): Promise<ProviderCapabilities> {
    return { protocolVersions: [1], maxBatchSize: 100, artifactTransfer: true };
  }

  async hasArtifact(): Promise<boolean> {
    return false;
  }

  async uploadArtifact(input: {
    contentSha256: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<{ remoteLocator: string }> {
    this.uploaded.set(input.contentSha256, input.bytes);
    return { remoteLocator: `sha256:${input.contentSha256}` };
  }
}

test("rejects artifact paths outside the configured root", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "radius-artifact-path-"));
  try {
    const artifactRoot = path.join(directory, "artifacts");
    const nestedArtifact = path.join(artifactRoot, "sha256", "aa", "file");
    const outsideFile = path.join(directory, "secret.txt");
    await mkdir(path.dirname(nestedArtifact), { recursive: true });
    await writeFile(nestedArtifact, "inside");
    await writeFile(outsideFile, "outside");
    await symlink(outsideFile, path.join(artifactRoot, "escape"));

    await assert.rejects(
      resolveLocalArtifactPath(artifactRoot, "../secret.txt"),
      /ARTIFACT_PATH_OUTSIDE_ROOT/,
    );
    await assert.rejects(
      resolveLocalArtifactPath(artifactRoot, outsideFile),
      /ARTIFACT_PATH_OUTSIDE_ROOT/,
    );
    await assert.rejects(
      resolveLocalArtifactPath(artifactRoot, "escape"),
      /ARTIFACT_PATH_OUTSIDE_ROOT/,
    );
    assert.equal(
      await resolveLocalArtifactPath(artifactRoot, "sha256/aa/file"),
      await realpath(nestedArtifact),
    );
  } finally {
    await removeTemporaryDirectory(directory);
  }
});

test("pushes pending changes and idempotently applies the echoed pull", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "radius-sync-core-"));
  const database = await openRadiusDatabase({
    path: path.join(directory, "radius.db"),
  });
  try {
    await migrateRadiusDatabase(database, migrationsFolder);
    await ensureClientInstance(database, {
      id: clientInstanceId,
      displayName: "Test Mac",
      platform: "darwin",
      publicKeyJwk: "{}",
    });
    await configureSyncConnection(database, {
      id: connectionId,
      providerKey: "echo",
      endpointUrl: "https://sync.example.test",
      credentialRef: null,
      remoteSubject: null,
      accountLabel: null,
      enabled: true,
    });
    await createSession(database, {
      originClientInstanceId: clientInstanceId,
      title: "Sync engine test",
    });

    const result = await new SyncEngine().run(
      database,
      connectionId,
      clientInstanceId,
      new EchoProvider(),
    );
    assert.deepEqual(result, {
      pushed: 1,
      pulled: 1,
      duplicates: 1,
      uploadedArtifacts: 0,
      nextCursor: "cursor-1",
    });
    assert.equal(
      (await database.db.select().from(syncDeliveries))[0]?.state,
      "acked",
    );
    assert.equal(
      (await database.db.select().from(syncCursors))[0]?.pullCursor,
      "cursor-1",
    );
  } finally {
    database.close();
    await removeTemporaryDirectory(directory);
  }
});

test("uploads a verified local file artifact after its metadata change", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "radius-sync-artifact-"));
  const artifactRoot = path.join(directory, "artifacts");
  const database = await openRadiusDatabase({
    path: path.join(directory, "radius.db"),
  });
  try {
    await migrateRadiusDatabase(database, migrationsFolder);
    await ensureClientInstance(database, {
      id: clientInstanceId,
      displayName: "Test Mac",
      platform: "darwin",
      publicKeyJwk: "{}",
    });
    await configureSyncConnection(database, {
      id: connectionId,
      providerKey: "artifact",
      endpointUrl: "https://sync.example.test",
      credentialRef: null,
      remoteSubject: null,
      accountLabel: null,
      enabled: true,
    });
    const session = await createSession(database, {
      originClientInstanceId: clientInstanceId,
      title: "Artifact sync test",
    });
    const bytes = Buffer.from("artifact bytes");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const relativePath = `sha256/${hash.slice(0, 2)}/${hash}`;
    await mkdir(path.dirname(path.join(artifactRoot, relativePath)), {
      recursive: true,
    });
    await writeFile(path.join(artifactRoot, relativePath), bytes);
    const artifactId = randomUUID();
    await appendSessionEvent(
      database,
      {
        eventId: randomUUID(),
        sessionId: session.id,
        sessionRevision: 2,
        sourceClientInstanceId: clientInstanceId,
        agentRunId: null,
        occurredAt: new Date().toISOString(),
        eventType: "message",
        role: "assistant",
        messageKind: "final",
        status: "completed",
        model: null,
        providerMessageId: null,
        finishReason: null,
        artifactLinks: [
          {
            relationship: "output",
            artifact: {
              id: artifactId,
              sessionId: session.id,
              name: "artifact.txt",
              artifactType: "document",
              storageKind: "file",
              mimeType: "text/plain",
              contentSha256: hash,
              byteSize: bytes.byteLength,
              supersedesArtifactId: null,
              createdAt: new Date().toISOString(),
              deletedAt: null,
            },
          },
        ],
        parts: [
          {
            id: randomUUID(),
            position: 0,
            partType: "artifact_reference",
            artifactId,
          },
        ],
      },
      { fileLocations: { [artifactId]: relativePath } },
    );
    await database.db.update(artifactTransfers).set({ state: "uploading" });

    const provider = new ArtifactProvider();
    const result = await new SyncEngine().run(
      database,
      connectionId,
      clientInstanceId,
      provider,
      { artifactRoot },
    );
    assert.equal(result.uploadedArtifacts, 1);
    assert.equal(
      Buffer.from(provider.uploaded.get(hash)!).toString(),
      "artifact bytes",
    );
    assert.equal(
      (await database.db.select().from(artifactTransfers))[0]?.state,
      "available",
    );
  } finally {
    database.close();
    await removeTemporaryDirectory(directory);
  }
});
