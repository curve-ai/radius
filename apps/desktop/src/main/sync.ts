import { createHash } from "node:crypto";
import path from "node:path";

import {
  configureSyncConnection,
  disableSyncConnections,
  enableSyncConnection,
  getEnabledSyncConnection,
  getMostRecentSyncConnection,
  type SyncConnectionRecord,
} from "@curve-ai/radius-storage";
import { HttpSyncProvider, SyncEngine } from "@curve-ai/radius-sync-core";
import { app } from "electron";

import { authenticateCloud, getCloudAccessToken } from "./cloud-auth";
import { validatedCloudUrl } from "./cloud-url";
import { localDeviceIdentity } from "./device-identity";
import type { StorageContext } from "./storage";
import type { CloudConnectionInput, DesktopSyncStatus } from "../radius-api";

const SYNC_REQUEST_TIMEOUT_MS = 30_000;
type AccessTokenProvider = (signal?: AbortSignal) => Promise<string>;

let status: DesktopSyncStatus = {
  state: "disabled",
  providerKey: null,
  endpointUrl: null,
  lastSuccessAt: null,
  errorCode: null,
};
let storageContext: StorageContext | null = null;
let timer: NodeJS.Timeout | null = null;
let runPromise: Promise<void> | null = null;
let manualRun: (() => Promise<void>) | null = null;
let activeAbortController: AbortController | null = null;
let connectionGeneration = 0;

function stableUuid(value: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(value).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function syncEndpoint(apiUrl: string): string {
  const base = validatedCloudUrl(apiUrl);
  return new URL("/api/sync/v1/", base).toString();
}

function cancellableFetch(controller: AbortController): typeof fetch {
  return (input, init) => {
    const signals = [
      controller.signal,
      AbortSignal.timeout(SYNC_REQUEST_TIMEOUT_MS),
    ];
    if (init?.signal) signals.push(init.signal);
    return globalThis.fetch(input, {
      ...init,
      signal: AbortSignal.any(signals),
    });
  };
}

function cloudFrontendFromCredentialRef(value: string | null): string | null {
  const prefix = "electron-session:";
  return value?.startsWith(prefix) ? value.slice(prefix.length) : null;
}

export function getSyncStatus(): DesktopSyncStatus {
  return { ...status };
}

async function stopActiveSync(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  manualRun = null;
  const controller = activeAbortController;
  activeAbortController = null;
  controller?.abort();
  await runPromise;
}

async function startConnection(
  context: StorageContext,
  connection: SyncConnectionRecord,
  getAccessToken: AccessTokenProvider,
): Promise<void> {
  const generation = ++connectionGeneration;
  await stopActiveSync();
  if (generation !== connectionGeneration) return;
  const abortController = new AbortController();
  activeAbortController = abortController;
  const ownsConnection = (): boolean =>
    generation === connectionGeneration &&
    activeAbortController === abortController &&
    !abortController.signal.aborted;
  const providerState = {
    providerKey: connection.providerKey,
    endpointUrl: connection.endpointUrl,
  };
  const provider = new HttpSyncProvider({
    endpoint: connection.endpointUrl,
    identity: {
      ...localDeviceIdentity(context.vault),
      privateKeyJwk: context.vault.privateKeyJwk,
      appVersion: process.env.npm_package_version || "0.0.1",
    },
    getAccessToken: () => getAccessToken(abortController.signal),
    fetch: cancellableFetch(abortController),
  });
  const engine = new SyncEngine();
  let deviceRegistered = false;
  const run = async (): Promise<void> => {
    if (!ownsConnection()) return;
    if (runPromise) return runPromise;
    const promise = (async () => {
      if (!ownsConnection()) return;
      status = { ...status, state: "syncing", errorCode: null };
      try {
        if (!deviceRegistered) {
          await provider.registerDevice();
          deviceRegistered = true;
        }
        await engine.run(
          context.database,
          connection.id,
          context.vault.clientInstanceId,
          provider,
          { artifactRoot: path.join(app.getPath("userData"), "artifacts") },
        );
        if (!ownsConnection()) return;
        status = {
          state: "idle",
          ...providerState,
          lastSuccessAt: new Date().toISOString(),
          errorCode: null,
        };
      } catch (error) {
        if (!ownsConnection()) return;
        status = {
          ...status,
          state: "error",
          errorCode: error instanceof Error ? error.message : "SYNC_FAILED",
        };
      }
    })();
    runPromise = promise;
    void promise.finally(() => {
      if (runPromise === promise) runPromise = null;
    });
    return promise;
  };

  status = {
    state: "idle",
    ...providerState,
    lastSuccessAt: null,
    errorCode: null,
  };
  manualRun = run;
  await run();
  if (!ownsConnection()) return;
  timer = setInterval(() => void run(), 30_000);
  timer.unref();
}

function accessTokenProvider(
  connection: SyncConnectionRecord,
): AccessTokenProvider | null {
  if (connection.credentialRef === "environment:RADIUS_SYNC_TOKEN") {
    const token = process.env.RADIUS_SYNC_TOKEN?.trim();
    return token ? async () => token : null;
  }
  const frontendUrl = cloudFrontendFromCredentialRef(connection.credentialRef);
  return frontendUrl
    ? (signal) => getCloudAccessToken(frontendUrl, signal)
    : null;
}

export async function initializeSync(context: StorageContext): Promise<void> {
  storageContext = context;
  const endpoint = process.env.RADIUS_SYNC_ENDPOINT?.trim();
  const token = process.env.RADIUS_SYNC_TOKEN?.trim();
  if (endpoint && token) {
    try {
      const endpointUrl = validatedCloudUrl(endpoint).toString();
      const connection = await configureSyncConnection(context.database, {
        id: stableUuid(`http-sync\0${endpointUrl}`),
        providerKey: "http",
        endpointUrl,
        credentialRef: "environment:RADIUS_SYNC_TOKEN",
        remoteSubject: null,
        accountLabel: null,
        enabled: true,
      });
      await startConnection(context, connection, async () => token);
    } catch (error) {
      status = {
        state: "error",
        providerKey: "http",
        endpointUrl: endpoint,
        lastSuccessAt: null,
        errorCode:
          error instanceof Error ? error.message : "SYNC_CONFIGURATION_FAILED",
      };
    }
    return;
  }

  const connection = await getEnabledSyncConnection(context.database);
  const tokenProvider = connection ? accessTokenProvider(connection) : null;
  if (!connection || !tokenProvider) {
    status = {
      state: "disabled",
      providerKey: connection?.providerKey ?? null,
      endpointUrl: connection?.endpointUrl ?? null,
      lastSuccessAt: null,
      errorCode: null,
    };
    return;
  }
  await startConnection(context, connection, tokenProvider);
}

export async function connectCloud(
  input: CloudConnectionInput,
): Promise<DesktopSyncStatus> {
  if (!storageContext) throw new Error("STORAGE_NOT_READY");
  const frontendUrl = validatedCloudUrl(input.frontendUrl).toString();
  const endpointUrl = syncEndpoint(input.apiUrl);
  await authenticateCloud(frontendUrl);
  const connection = await configureSyncConnection(storageContext.database, {
    id: stableUuid(`curve-cloud\0${endpointUrl}`),
    providerKey: "curve-cloud",
    endpointUrl,
    credentialRef: `electron-session:${frontendUrl}`,
    remoteSubject: null,
    accountLabel: null,
    enabled: true,
  });
  await startConnection(storageContext, connection, (signal) =>
    getCloudAccessToken(frontendUrl, signal),
  );
  return getSyncStatus();
}

export async function runSyncNow(): Promise<DesktopSyncStatus> {
  await manualRun?.();
  return getSyncStatus();
}

export async function setSyncEnabled(
  enabled: boolean,
): Promise<DesktopSyncStatus> {
  if (!storageContext) throw new Error("STORAGE_NOT_READY");
  if (!enabled) {
    await stopSync();
    const connection = await getMostRecentSyncConnection(
      storageContext.database,
    );
    await disableSyncConnections(storageContext.database);
    status = {
      state: "disabled",
      providerKey: connection?.providerKey ?? null,
      endpointUrl: connection?.endpointUrl ?? null,
      lastSuccessAt: null,
      errorCode: null,
    };
    return getSyncStatus();
  }

  const connection = await getMostRecentSyncConnection(storageContext.database);
  if (!connection) throw new Error("SYNC_PROVIDER_REQUIRED");
  const tokenProvider = accessTokenProvider(connection);
  if (!tokenProvider) throw new Error("SYNC_REAUTHENTICATION_REQUIRED");
  await enableSyncConnection(storageContext.database, connection.id);
  await startConnection(
    storageContext,
    { ...connection, enabled: true },
    tokenProvider,
  );
  return getSyncStatus();
}

export async function stopSync(): Promise<void> {
  connectionGeneration += 1;
  await stopActiveSync();
}

export async function getConnectorCatalogAccessToken(
  signal?: AbortSignal,
): Promise<string> {
  if (!storageContext) throw new Error("STORAGE_NOT_READY");
  const connection = await getMostRecentSyncConnection(storageContext.database);
  if (!connection) throw new Error("CLOUD_CONNECTION_REQUIRED");
  const provider = accessTokenProvider(connection);
  if (!provider) throw new Error("SYNC_REAUTHENTICATION_REQUIRED");
  return provider(signal);
}
