import {
  MAX_SYNC_BATCH_SIZE,
  PushRequestSchema,
  type SyncChangeEnvelope,
} from "@curve-ai/radius-sync-protocol";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  claimPendingArtifactTransfers,
  applyRemoteChange,
  claimPendingDeliveries,
  getPullCursor,
  recordPushResults,
  recordArtifactTransferFailure,
  recordArtifactTransferSuccess,
  recordTransientFailure,
  resetInFlightArtifactTransfers,
  resetInFlightDeliveries,
  savePullCursor,
  type RadiusDatabase,
} from "@curve-ai/radius-storage";

import { assertCompatibleProvider, type SyncProvider } from "./provider.js";

export interface SyncRunResult {
  pushed: number;
  pulled: number;
  duplicates: number;
  uploadedArtifacts: number;
  nextCursor: string | null;
}

function isWithinRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export async function resolveLocalArtifactPath(
  artifactRoot: string,
  localRelativePath: string,
): Promise<string> {
  if (path.isAbsolute(localRelativePath)) {
    throw new Error("ARTIFACT_PATH_OUTSIDE_ROOT");
  }
  const root = path.resolve(artifactRoot);
  const resolved = path.resolve(root, localRelativePath);
  if (!isWithinRoot(root, resolved)) {
    throw new Error("ARTIFACT_PATH_OUTSIDE_ROOT");
  }

  const [canonicalRoot, canonicalTarget] = await Promise.all([
    realpath(root),
    realpath(resolved),
  ]);
  if (!isWithinRoot(canonicalRoot, canonicalTarget)) {
    throw new Error("ARTIFACT_PATH_OUTSIDE_ROOT");
  }
  return canonicalTarget;
}

export class SyncEngine {
  readonly #activeConnections = new Set<string>();
  readonly #recoveredConnections = new Set<string>();

  async run(
    database: RadiusDatabase,
    connectionId: string,
    clientInstanceId: string,
    provider: SyncProvider,
    options: { artifactRoot?: string } = {},
  ): Promise<SyncRunResult> {
    if (this.#activeConnections.has(connectionId)) {
      throw new Error("SYNC_ALREADY_RUNNING");
    }
    this.#activeConnections.add(connectionId);
    try {
      const capabilities = await provider.capabilities();
      assertCompatibleProvider(capabilities);
      const limit = Math.min(capabilities.maxBatchSize, MAX_SYNC_BATCH_SIZE);

      if (!this.#recoveredConnections.has(connectionId)) {
        await resetInFlightDeliveries(database, connectionId);
        await resetInFlightArtifactTransfers(database, connectionId);
        this.#recoveredConnections.add(connectionId);
      }
      const deliveries = await claimPendingDeliveries(
        database,
        connectionId,
        limit,
      );
      if (deliveries.length > 0) {
        try {
          const request = PushRequestSchema.parse({
            protocolVersion: 1,
            clientInstanceId,
            changes: deliveries.map((delivery) => delivery.change),
          });
          const response = await provider.push(request);
          const expected = new Set(
            deliveries.map((delivery) => delivery.change.changeId),
          );
          if (
            response.results.length !== expected.size ||
            response.results.some(
              (result) => !expected.delete(result.changeId),
            ) ||
            expected.size !== 0
          ) {
            throw new Error("SYNC_PUSH_RESULT_MISMATCH");
          }
          await recordPushResults(database, connectionId, response.results);
        } catch (error) {
          await recordTransientFailure(
            database,
            connectionId,
            deliveries,
            error instanceof Error ? error.message : "SYNC_PUSH_FAILED",
          );
          throw error;
        }
      }

      let uploadedArtifacts = 0;
      if (
        capabilities.artifactTransfer &&
        options.artifactRoot &&
        provider.hasArtifact &&
        provider.uploadArtifact
      ) {
        const transfers = await claimPendingArtifactTransfers(
          database,
          connectionId,
          limit,
        );
        for (const transfer of transfers) {
          try {
            const bytes = await readFile(
              await resolveLocalArtifactPath(
                options.artifactRoot,
                transfer.localRelativePath,
              ),
            );
            if (bytes.byteLength !== transfer.byteSize) {
              throw new Error("ARTIFACT_SIZE_MISMATCH");
            }
            if (
              createHash("sha256").update(bytes).digest("hex") !==
              transfer.contentSha256
            ) {
              throw new Error("ARTIFACT_HASH_MISMATCH");
            }
            const remote = (await provider.hasArtifact(transfer.contentSha256))
              ? { remoteLocator: `sha256:${transfer.contentSha256}` }
              : await provider.uploadArtifact({
                  contentSha256: transfer.contentSha256,
                  mimeType: transfer.mimeType,
                  bytes,
                });
            await recordArtifactTransferSuccess(
              database,
              connectionId,
              transfer.artifactId,
              remote.remoteLocator,
            );
            uploadedArtifacts += 1;
          } catch (error) {
            await recordArtifactTransferFailure(
              database,
              connectionId,
              transfer,
              error instanceof Error ? error.message : "ARTIFACT_UPLOAD_FAILED",
            );
          }
        }
      }

      const cursor = await getPullCursor(database, connectionId);
      const pulled = await provider.pull(cursor, limit);
      let duplicates = 0;
      for (const change of pulled.changes as SyncChangeEnvelope[]) {
        if (
          (await applyRemoteChange(database, connectionId, change)) ===
          "duplicate"
        ) {
          duplicates += 1;
        }
      }
      await savePullCursor(database, connectionId, pulled.nextCursor);

      return {
        pushed: deliveries.length,
        pulled: pulled.changes.length,
        duplicates,
        uploadedArtifacts,
        nextCursor: pulled.nextCursor,
      };
    } finally {
      this.#activeConnections.delete(connectionId);
    }
  }
}
