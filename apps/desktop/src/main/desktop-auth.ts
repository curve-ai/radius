import {
  assertBundleMatchesPlatform,
  assertProfileIdentity,
  assertUsableDesktopSession,
} from "./desktop-auth-policy";
import { app, shell } from "electron";
import { readBoundedText } from "@curve-ai/platform-client";
import {
  NativeOAuthConfigurationSchema,
  type NativeAuthorizationResponse,
  type NativeAgentCredential,
  type NativeOAuthConfiguration,
} from "@curve-ai/platform-contracts";
import { getMostRecentSyncConnection } from "@curve-ai/radius-storage";
import type { DesktopAuthenticationStatus } from "../auth-types";
import { initializeStorage } from "./storage";
import { readDesktopPlatformUrl, readDistribution } from "./distribution";
import { nativeBrowserLogin } from "./native-login";
import { connectNativePlatform, stopSync } from "./sync";

const SECRET = "distribution:oauth";
const distribution = readDistribution();
const platformUrl = readDesktopPlatformUrl();
let status: DesktopAuthenticationStatus = {
  state: "checking",
  displayName: distribution?.displayName ?? "Radius",
  signInName: distribution?.signInName ?? "Curve",
  organizationName: null,
  errorCode: null,
};
let configuration: NativeOAuthConfiguration | null = null;
let credentials: NativeAuthorizationResponse | null = null;
let attempt: AbortController | null = null;
let pending: Promise<void> | null = null;
let renewal: NodeJS.Timeout | null = null;
// Main owns runtime startup/shutdown; the auth guard is also consumed by the
// runtime, so inject shutdown rather than creating a circular module import.
let stopAgentRuntime: () => void;

export function desktopAuthenticationStatus(): DesktopAuthenticationStatus {
  return { ...status };
}
export function assertDesktopAuthenticated(): void {
  assertUsableDesktopSession(status.state, credentials);
}
export function platformAgentId(): string | null {
  assertDesktopAuthenticated();
  if (!configuration) throw new Error("AUTHENTICATION_REQUIRED");
  return distribution?.agentId ?? null;
}
export function platformAgentCredential(
  agentId: string,
): NativeAgentCredential | null {
  assertDesktopAuthenticated();
  if (!distribution) return null;
  if (agentId !== configuration?.agentId)
    throw new Error("PLATFORM_AGENT_REQUIRED");
  return credentials!.agent;
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(
    new URL(`api/platform/v1/auth/native/${path}`, platformUrl),
    {
      ...init,
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(30_000),
        ...(init.signal ? [init.signal] : []),
      ]),
      headers: { "Content-Type": "application/json", ...init.headers },
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 404 || (path === "config" && response.status === 503)
        ? "AUTH_NOT_CONFIGURED"
        : "AUTH_SIGN_IN_FAILED",
    );
  return readAuthenticationJson(response);
}

async function readAuthenticationJson(response: Response): Promise<unknown> {
  return JSON.parse(
    await readBoundedText(
      response.body,
      65536,
      () => new Error("AUTH_RESPONSE_INVALID"),
    ),
  );
}

async function loadConfiguration(
  signal: AbortSignal,
): Promise<NativeOAuthConfiguration & { authorizationEndpoint: string }> {
  const raw = (await request("config", { signal })) as Record<string, unknown>;
  const next = NativeOAuthConfigurationSchema.parse(
    Object.fromEntries(
      Object.entries(raw).filter(([key]) => key !== "authorizationEndpoint"),
    ),
  );
  if (typeof raw.authorizationEndpoint !== "string") {
    throw new Error("AUTH_CONFIGURATION_INVALID");
  }
  assertBundleMatchesPlatform(distribution, next);
  configuration = next;
  return { ...next, authorizationEndpoint: raw.authorizationEndpoint };
}

function parseCredentials(value: unknown): NativeAuthorizationResponse {
  const candidate = value as NativeAuthorizationResponse;
  if (
    !configuration ||
    !candidate ||
    typeof candidate.platformSessionToken !== "string" ||
    !/^radius_native_[A-Za-z0-9_-]+$/.test(candidate.platformSessionToken) ||
    typeof candidate.accountId !== "string" ||
    !candidate.organization ||
    candidate.organization.slug !== configuration.organizationSlug ||
    !candidate.agent ||
    typeof candidate.agent.accessToken !== "string" ||
    !candidate.agent.accessToken ||
    !Array.isArray(candidate.agent.scopes) ||
    !Number.isFinite(Date.parse(candidate.agent.expiresAt)) ||
    !Number.isFinite(Date.parse(candidate.platformExpiresAt)) ||
    (candidate.refreshToken !== undefined &&
      typeof candidate.refreshToken !== "string")
  )
    throw new Error("AUTH_RESPONSE_INVALID");
  return candidate;
}
async function accept(value: unknown, signal: AbortSignal): Promise<void> {
  const next = parseCredentials(value);
  const storage = await initializeStorage();
  const previous = await getMostRecentSyncConnection(storage.database);
  assertProfileIdentity(previous?.remoteSubject, next.accountId);
  if (signal.aborted) throw new Error("AUTH_CANCELLED");
  await storage.vault.setSecret(SECRET, JSON.stringify(next));
  if (signal.aborted) throw new Error("AUTH_CANCELLED");
  credentials = next;
  status = {
    ...status,
    state: "preparing",
    organizationName: next.organization.displayName,
    errorCode: null,
  };
  await connectNativePlatform(
    storage,
    platformUrl,
    next,
    async () => {
      if (
        !credentials ||
        Date.parse(credentials.platformExpiresAt) <= Date.now()
      )
        throw new Error("AUTH_SESSION_EXPIRED");
      return credentials.platformSessionToken;
    },
    () => {
      credentials = null;
      if (renewal) clearTimeout(renewal);
      stopAgentRuntime();
      status = { ...status, state: "error", errorCode: "AUTH_SESSION_EXPIRED" };
    },
  );
  if (signal.aborted) {
    await stopSync();
    throw new Error("AUTH_CANCELLED");
  }
  if (!credentials) throw new Error("AUTH_SESSION_EXPIRED");
  status = { ...status, state: "ready" };
  scheduleRenewal();
}
function scheduleRenewal(): void {
  if (renewal) clearTimeout(renewal);
  if (!credentials) return;
  const expiry = Math.min(
    Date.parse(credentials.agent.expiresAt),
    Date.parse(credentials.platformExpiresAt),
  );
  renewal = setTimeout(
    () => {
      void run(async (signal) => {
        if (!credentials) throw new Error("AUTH_SESSION_EXPIRED");
        await refresh(credentials, signal);
      });
    },
    Math.max(1000, (expiry - Date.now()) * 0.8),
  );
  renewal.unref();
}

async function refresh(
  previous: NativeAuthorizationResponse,
  signal: AbortSignal,
): Promise<void> {
  if (!previous.refreshToken) throw new Error("AUTH_SESSION_EXPIRED");
  const next = parseCredentials(
    await request("refresh", {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${previous.platformSessionToken}` },
      body: JSON.stringify({ refreshToken: previous.refreshToken }),
    }),
  );
  next.refreshToken ??= previous.refreshToken;
  await accept(next, signal);
}
async function run(
  operation: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  if (pending) return pending;
  const controller = new AbortController();
  attempt = controller;
  pending = operation(controller.signal)
    .catch(async (error: unknown) => {
      credentials = null;
      stopAgentRuntime();
      await stopSync();
      const code =
        error instanceof Error && /^AUTH_[A-Z_]+$/.test(error.message)
          ? error.message
          : "AUTH_SIGN_IN_FAILED";
      status = {
        ...status,
        state: code === "AUTH_CANCELLED" ? "signed-out" : "error",
        errorCode: code,
      };
    })
    .finally(() => {
      pending = null;
      attempt = null;
    });
  return pending;
}
export async function initializeDesktopAuthentication(
  stopRuntime: () => void,
): Promise<void> {
  stopAgentRuntime = stopRuntime;
  await run(async (signal) => {
    const activeConfiguration = await loadConfiguration(signal);
    const stored = await (await initializeStorage()).vault.getSecret(SECRET);
    if (!stored) {
      status = { ...status, state: "signed-out" };
      return;
    }
    const previous = parseCredentials(JSON.parse(stored));
    if (Date.parse(previous.platformExpiresAt) <= Date.now())
      throw new Error("AUTH_SESSION_EXPIRED");
    const response = await fetch(
      new URL("api/platform/v1/auth/session", platformUrl),
      {
        headers: { Authorization: `Bearer ${previous.platformSessionToken}` },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      },
    );
    if (!response.ok) throw new Error("AUTH_SESSION_EXPIRED");
    const identity = (await readAuthenticationJson(response)) as {
      accountId?: string;
      organizations?: Array<{ slug: string }>;
    };
    if (
      identity.accountId !== previous.accountId ||
      !identity.organizations?.some(
        (org) => org.slug === activeConfiguration.organizationSlug,
      )
    )
      throw new Error("AUTH_PROFILE_MISMATCH");
    if (Date.parse(previous.agent.expiresAt) <= Date.now() + 60_000) {
      await refresh(previous, signal);
    } else await accept(previous, signal);
  });
}
export async function signInToPlatform(): Promise<DesktopAuthenticationStatus> {
  await run(async (signal) => {
    status = { ...status, state: "checking", errorCode: null };
    const config = await loadConfiguration(signal);
    status = { ...status, state: "awaiting-browser" };
    const authorization = await nativeBrowserLogin(
      config,
      (url) => shell.openExternal(url),
      signal,
    );
    status = { ...status, state: "preparing" };
    await accept(
      await request("exchange", {
        method: "POST",
        signal,
        body: JSON.stringify(authorization),
      }),
      signal,
    );
  });
  return desktopAuthenticationStatus();
}
export async function signOutOfPlatform(): Promise<DesktopAuthenticationStatus> {
  attempt?.abort();
  await pending;
  if (renewal) clearTimeout(renewal);
  renewal = null;
  const previous = credentials;
  credentials = null;
  status = {
    ...status,
    state: "signed-out",
    errorCode: null,
    organizationName: null,
  };
  stopAgentRuntime();
  await stopSync();
  await (await initializeStorage()).vault.deleteSecret(SECRET);
  if (previous)
    void request("logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${previous.platformSessionToken}` },
    }).catch(() => {});
  return desktopAuthenticationStatus();
}
export function cancelPlatformSignIn(): void {
  attempt?.abort();
}
app.on("before-quit", () => {
  attempt?.abort();
  if (renewal) clearTimeout(renewal);
});
