import {
  MAX_SYNC_BATCH_SIZE,
  type ProviderCapabilities,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from "@curve-ai/radius-sync-protocol";

export interface SyncProvider {
  capabilities(): Promise<ProviderCapabilities>;
  push(request: PushRequest): Promise<PushResponse>;
  pull(cursor: string | null, limit?: number): Promise<PullResponse>;
  hasArtifact?(contentSha256: string): Promise<boolean>;
  uploadArtifact?(input: {
    contentSha256: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<{ remoteLocator: string }>;
}

export function assertCompatibleProvider(
  capabilities: ProviderCapabilities,
): void {
  if (!capabilities.protocolVersions.includes(1)) {
    throw new Error("SYNC_PROTOCOL_UNSUPPORTED");
  }
  if (
    capabilities.maxBatchSize < 1 ||
    capabilities.maxBatchSize > MAX_SYNC_BATCH_SIZE
  ) {
    throw new Error("SYNC_BATCH_LIMIT_INVALID");
  }
}
