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

import { connectViaCloud } from "./cloud-onboarding";
import {
  deviceDisplayName,
  loadSyncDeviceIdentity,
  rotateSyncDeviceIdentity,
} from "./device-identity";
import {
  PLATFORM_PARTITION,
  platformDeploymentMode,
  platformFetch,
  platformIdentity,
  platformLogout,
  signInToPlatform,
  type PlatformOrganization,
} from "./platform-connection";
import {
  platformBaseFromEndpoint,
  platformSyncEndpoint,
  validatedPlatformUrl,
} from "./platform-endpoint";
import type { StorageContext } from "./storage";
import type {
  DesktopSyncStatus,
  PlatformConnectionInput,
  PlatformConnectionSummary,
} from "../radius-api";

const SYNC_REQUEST_TIMEOUT_MS = 30_000;
const PROVIDER_KEY = "radius-platform";
const ENVIRONMENT_CREDENTIAL = "environment:RADIUS_SYNC_TOKEN";

type AccessTokenProvider = (signal?: AbortSignal) => Promise<string>;

let status: DesktopSyncStatus = {
  state: "disabled",
  providerKey: null,
  endpointUrl: null,
  lastSuccessAt: null,
  errorCode: null,
  connection: null,
  progress: null,
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

function connectionSummary(
  connection: SyncConnectionRecord,
): PlatformConnectionSummary {
  return {
    baseUrl: platformBaseFromEndpoint(connection.endpointUrl),
    mode: connection.deploymentMode === "managed" ? "managed" : "self_hosted",
    organizationSlug: connection.organizationSlug,
    organizationName: connection.accountLabel,
    role: connection.organizationRole,
    accountId: connection.remoteSubject,
  };
}

export function getSyncStatus(): DesktopSyncStatus {
  return { ...status };
}

function setProgress(message: string | null): void {
  status = { ...status, progress: message };
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
  getAccessToken: AccessTokenProvider | null,
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

  const summary = connectionSummary(connection);
  const providerState = {
    providerKey: connection.providerKey,
    endpointUrl: connection.endpointUrl,
    connection: summary,
  };

  const identity = await loadSyncDeviceIdentity(context.vault);
  // A token connection is headless and has no session partition to speak of;
  // everything else authenticates with the platform cookie, which only the
  // partition's own fetch will send.
  const transport = getAccessToken ? globalThis.fetch : platformFetch;
  const provider = new HttpSyncProvider({
    endpoint: platformSyncEndpoint(summary.baseUrl),
    identity: {
      ...identity,
      displayName: deviceDisplayName(),
      platform: process.platform,
      appVersion: process.env.npm_package_version || "0.0.1",
    },
    ...(getAccessToken
      ? { getAccessToken: () => getAccessToken(abortController.signal) }
      : {}),
    rotateIdentity: async () => {
      const rotated = await rotateSyncDeviceIdentity(context.vault);
      return {
        ...rotated,
        displayName: deviceDisplayName(),
        platform: process.platform,
        appVersion: process.env.npm_package_version || "0.0.1",
      };
    },
    fetch: withTimeout(abortController, transport),
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
          provider.clientInstanceId,
          provider,
          { artifactRoot: path.join(app.getPath("userData"), "artifacts") },
        );
        if (!ownsConnection()) return;
        status = {
          state: "idle",
          ...providerState,
          lastSuccessAt: new Date().toISOString(),
          errorCode: null,
          progress: null,
        };
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
          await stopActiveSync();
        }
        status = { ...status, state: "error", errorCode, progress: null };
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
    progress: null,
  };
  manualRun = run;
  await run();
  if (!ownsConnection()) return;
  timer = setInterval(() => void run(), 30_000);
  timer.unref();
}

/**
 * Headless installations set `RADIUS_SYNC_TOKEN` to a platform developer
 * token. Everything else rides the browser session in the Electron partition
 * and has no token at all.
 */
function accessTokenProvider(
  connection: SyncConnectionRecord,
): AccessTokenProvider | null {
  if (connection.credentialRef !== ENVIRONMENT_CREDENTIAL) return null;
  const token = process.env.RADIUS_SYNC_TOKEN?.trim();
  if (!token) throw new Error("SYNC_REAUTHENTICATION_REQUIRED");
  return async () => token;
}

function canResume(connection: SyncConnectionRecord): boolean {
  if (connection.credentialRef === ENVIRONMENT_CREDENTIAL) {
    return Boolean(process.env.RADIUS_SYNC_TOKEN?.trim());
  }
  return connection.sessionPartition === PLATFORM_PARTITION;
}

export async function initializeSync(context: StorageContext): Promise<void> {
  storageContext = context;
  const endpoint = process.env.RADIUS_SYNC_ENDPOINT?.trim();
  const token = process.env.RADIUS_SYNC_TOKEN?.trim();
  if (endpoint && token) {
    try {
      const baseUrl = platformBaseFromEndpoint(endpoint);
      const connection = await configureSyncConnection(context.database, {
        id: stableUuid(`${PROVIDER_KEY}\0${baseUrl}`),
        providerKey: PROVIDER_KEY,
        endpointUrl: baseUrl,
        credentialRef: ENVIRONMENT_CREDENTIAL,
        remoteSubject: null,
        accountLabel: null,
        deploymentMode: null,
        organizationSlug: null,
        organizationRole: null,
        sessionPartition: null,
        enabled: true,
      });
      await startConnection(context, connection, async () => token);
    } catch (error) {
      status = {
        state: "error",
        providerKey: PROVIDER_KEY,
        endpointUrl: endpoint,
        lastSuccessAt: null,
        errorCode:
          error instanceof Error ? error.message : "SYNC_CONFIGURATION_FAILED",
        connection: null,
        progress: null,
      };
    }
    return;
  }

  const connection = await getEnabledSyncConnection(context.database);
  if (!connection || !canResume(connection)) {
    status = {
      state: "disabled",
      providerKey: connection?.providerKey ?? null,
      endpointUrl: connection?.endpointUrl ?? null,
      lastSuccessAt: null,
      errorCode: null,
      connection: connection ? connectionSummary(connection) : null,
      progress: null,
    };
    return;
  }
  await startConnection(context, connection, accessTokenProvider(connection));
}

/**
 * Signs in to a Radius platform and starts syncing against it. Curve Cloud
 * finds the workspace on the user's behalf; a self-hosted platform is the
 * address they typed. From the point of sign-in the two are the same API.
 */
export async function connectPlatform(
  input: PlatformConnectionInput,
): Promise<DesktopSyncStatus> {
  if (!storageContext) throw new Error("STORAGE_NOT_READY");

  let baseUrl: string;
  if (input.kind === "cloud") {
    const workspace = await connectViaCloud(__CLOUD_URL__, (message) =>
      setProgress(message),
    );
    baseUrl = workspace.baseUrl;
  } else {
    baseUrl = validatedPlatformUrl(input.url).toString();
  }
  setProgress(null);

  // Confirm this is a platform before opening a sign-in window at it, so a
  // wrong address fails with a useful message instead of a blank window.
  const mode = await platformDeploymentMode(baseUrl);

  await signInToPlatform(baseUrl);
  const identity = await platformIdentity(baseUrl);
  // Managed hosts scope the session to the organization that owns the host,
  // so the list holds one entry. A self-hosted platform serves one
  // organization too; take the first either way.
  const organization = identity.organizations[0] as PlatformOrganization;

  const connection = await configureSyncConnection(storageContext.database, {
    id: stableUuid(`${PROVIDER_KEY}\0${baseUrl}`),
    providerKey: PROVIDER_KEY,
    endpointUrl: baseUrl,
    credentialRef: `platform-session:${PLATFORM_PARTITION}`,
    remoteSubject: identity.accountId,
    accountLabel: organization.displayName,
    deploymentMode: mode,
    organizationSlug: organization.slug,
    organizationRole: organization.role,
    sessionPartition: PLATFORM_PARTITION,
    enabled: true,
  });
  await startConnection(storageContext, connection, null);
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
      connection: connection ? connectionSummary(connection) : null,
      progress: null,
    };
    return getSyncStatus();
  }

  const connection = await getMostRecentSyncConnection(storageContext.database);
  if (!connection) throw new Error("SYNC_PROVIDER_REQUIRED");
  if (!canResume(connection)) throw new Error("SYNC_REAUTHENTICATION_REQUIRED");
  await enableSyncConnection(storageContext.database, connection.id);
  await startConnection(
    storageContext,
    { ...connection, enabled: true },
    accessTokenProvider(connection),
  );
  return getSyncStatus();
}

/** Forgets the platform session and stops syncing, leaving local data alone. */
export async function disconnectPlatform(): Promise<DesktopSyncStatus> {
  if (!storageContext) throw new Error("STORAGE_NOT_READY");
  const connection = await getMostRecentSyncConnection(storageContext.database);
  await stopSync();
  await disableSyncConnections(storageContext.database);
  if (connection?.sessionPartition) {
    await platformLogout(platformBaseFromEndpoint(connection.endpointUrl));
  }
  status = {
    state: "disabled",
    providerKey: null,
    endpointUrl: null,
    lastSuccessAt: null,
    errorCode: null,
    connection: null,
    progress: null,
  };
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
  if (!connection) throw new Error("PLATFORM_CONNECTION_REQUIRED");
  const provider = accessTokenProvider(connection);
  if (!provider) throw new Error("SYNC_REAUTHENTICATION_REQUIRED");
  return provider(signal);
}
