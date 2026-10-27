import { createHash } from "node:crypto";
import path from "node:path";

import {
  configureSyncConnection,
  getMostRecentSyncConnection,
  type SyncConnectionRecord,
} from "@curve-ai/radius-storage";
import { HttpSyncProvider, SyncEngine } from "@curve-ai/radius-sync-core";
import { app } from "electron";
import { assertProfileIdentity } from "./desktop-auth-policy";

import {
  deviceDisplayName,
  loadSyncDeviceIdentity,
  rotateSyncDeviceIdentity,
} from "./device-identity";
import { platformSyncEndpoint } from "./platform-endpoint";
import type { StorageContext } from "./storage";

const SYNC_REQUEST_TIMEOUT_MS = 30_000;
const PROVIDER_KEY = "radius-platform";

type AccessTokenProvider = (signal?: AbortSignal) => Promise<string>;

let storageContext: StorageContext | null = null;
let timer: NodeJS.Timeout | null = null;
let runPromise: Promise<void> | null = null;
let activeAbortController: AbortController | null = null;
let connectionGeneration = 0;
let onNativeAuthenticationLost: (() => void) | null = null;

function stableUuid(value: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(value).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function withTimeout(
  controller: AbortController,
  base: typeof fetch,
): typeof fetch {
  return (input, init) => {
    const signals = [
      controller.signal,
      AbortSignal.timeout(SYNC_REQUEST_TIMEOUT_MS),
    ];
    if (init?.signal) signals.push(init.signal);
    return base(input, { ...init, signal: AbortSignal.any(signals) });
  };
}

/**
 * Stops the schedule and cancels anything in flight, without waiting for it.
 * Safe to call from inside a run: waiting there would mean the run awaiting
 * its own promise, which never resolves and wedges every later caller.
 */
function haltActiveSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
  const controller = activeAbortController;
  activeAbortController = null;
  controller?.abort();
}

/** Halts, then waits for the cancelled run to unwind. Never call from a run. */
async function stopActiveSync(): Promise<void> {
  const pending = runPromise;
  haltActiveSync();
  await pending;
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

  const identity = await loadSyncDeviceIdentity(context.vault);
  const provider = new HttpSyncProvider({
    endpoint: platformSyncEndpoint(connection.endpointUrl),
    identity: {
      ...identity,
      displayName: deviceDisplayName(),
      platform: process.platform,
      appVersion: process.env.npm_package_version || "0.0.1",
    },
    getAccessToken: () => getAccessToken(abortController.signal),
    rotateIdentity: async () => {
      const rotated = await rotateSyncDeviceIdentity(context.vault);
      return {
        ...rotated,
        displayName: deviceDisplayName(),
        platform: process.platform,
        appVersion: process.env.npm_package_version || "0.0.1",
      };
    },
    fetch: withTimeout(abortController, globalThis.fetch),
  });
  const engine = new SyncEngine();
  let deviceRegistered = false;

  const run = async (): Promise<void> => {
    if (!ownsConnection()) return;
    if (runPromise) return runPromise;
    const promise = (async () => {
      if (!ownsConnection()) return;
      try {
        if (!deviceRegistered) {
          await provider.registerDevice();
          deviceRegistered = true;
        }
        await engine.run(
          context.database,
          connection.id,
          provider.clientInstanceId,
          provider,
          { artifactRoot: path.join(app.getPath("userData"), "artifacts") },
        );
      } catch (error) {
        if (!ownsConnection()) return;
        const errorCode =
          error instanceof Error ? error.message : "SYNC_FAILED";
        // Losing the membership or the session is not a transient fault: no
        // amount of retrying fixes it, so stop and say so.
        if (
          errorCode.includes("SYNC_MEMBERSHIP_NOT_FOUND") ||
          errorCode.includes("401")
        ) {
          haltActiveSync();
          onNativeAuthenticationLost?.();
        } else {
          console.error(
            "[sync] Radius could not finish synchronization",
            error,
          );
        }
      }
    })();
    runPromise = promise;
    void promise.finally(() => {
      if (runPromise === promise) runPromise = null;
    });
    return promise;
  };

  await provider.registerDevice();
  deviceRegistered = true;
  void run();
  if (!ownsConnection()) return;
  timer = setInterval(() => void run(), 30_000);
  timer.unref();
}

export async function stopSync(): Promise<void> {
  connectionGeneration += 1;
  await stopActiveSync();
}

/**
 * How to authenticate a request to the bundle's Platform outside the sync
 * engine. Native auth always supplies a bearer token, regardless of who hosts
 * that Platform.
 */
export interface PlatformRequestCredentials {
  fetch: typeof globalThis.fetch;
  headers: Record<string, string>;
}

export async function platformRequestCredentials(
  signal?: AbortSignal,
): Promise<PlatformRequestCredentials> {
  signal?.throwIfAborted();
  if (!storageContext) throw new Error("STORAGE_NOT_READY");
  const connection = await getMostRecentSyncConnection(storageContext.database);
  if (!connection) throw new Error("PLATFORM_CONNECTION_REQUIRED");
  if (connection.credentialRef !== "distribution:oauth")
    throw new Error("SYNC_REAUTHENTICATION_REQUIRED");
  const stored = await storageContext.vault.getSecret("distribution:oauth");
  signal?.throwIfAborted();
  if (!stored) throw new Error("SYNC_REAUTHENTICATION_REQUIRED");
  const value = JSON.parse(stored) as {
    platformSessionToken: string;
    platformExpiresAt: string;
  };
  if (
    !value.platformSessionToken ||
    Date.parse(value.platformExpiresAt) <= Date.now()
  )
    throw new Error("SYNC_REAUTHENTICATION_REQUIRED");
  return {
    fetch: globalThis.fetch,
    headers: { authorization: `Bearer ${value.platformSessionToken}` },
  };
}

/** Auth startup supplies one native session for the bundle's Platform. */
export async function connectNativePlatform(
  context: StorageContext,
  platformUrl: string,
  session: import("@curve-ai/platform-contracts").NativeAuthorizationResponse,
  getToken: AccessTokenProvider,
  onAuthenticationLost: () => void,
): Promise<void> {
  storageContext = context;
  onNativeAuthenticationLost = onAuthenticationLost;
  const previous = await getMostRecentSyncConnection(context.database);
  assertProfileIdentity(previous?.remoteSubject, session.accountId);
  const connection = await configureSyncConnection(context.database, {
    id: stableUuid(`${PROVIDER_KEY}\0${platformUrl}\0${session.accountId}`),
    providerKey: PROVIDER_KEY,
    endpointUrl: platformUrl,
    credentialRef: "distribution:oauth",
    remoteSubject: session.accountId,
    accountLabel: session.organization.displayName,
    organizationSlug: session.organization.slug,
    organizationRole: session.organization.role,
    deploymentMode: null,
    sessionPartition: null,
    enabled: true,
  });
  await startConnection(context, connection, getToken);
}
