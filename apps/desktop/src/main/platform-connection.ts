import { BrowserWindow, session as electronSession, shell } from "electron";

import { platformUrl, validatedPlatformUrl } from "./platform-endpoint";

/**
 * One partition holds every platform cookie: the Curve Cloud onboarding
 * session and the organization host session are set by different origins but
 * belong to the same person, and sharing the partition is what lets the Cloud
 * flow finish without a second sign-in prompt.
 */
export const PLATFORM_PARTITION = "persist:radius-platform";

export type PlatformDeploymentMode = "managed" | "self_hosted";

export interface PlatformOrganization {
  id: string;
  slug: string;
  displayName: string;
  role: string;
}

export interface PlatformIdentity {
  accountId: string;
  organizations: PlatformOrganization[];
}

const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

export function platformSession(): Electron.Session {
  return electronSession.fromPartition(PLATFORM_PARTITION);
}

/**
 * The platform authenticates `/api/platform/v1/*` with the
 * `radius_platform_session` cookie, so every call must run on the partition
 * that holds it rather than on the global fetch.
 */
export const platformFetch: typeof globalThis.fetch = (input, init) =>
  platformSession().fetch(
    input instanceof Request ? input.url : input.toString(),
    { ...init, credentials: "include" },
  );

export async function platformDeploymentMode(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<PlatformDeploymentMode> {
  let response: Response;
  try {
    response = await platformFetch(
      platformUrl(baseUrl, "api/platform/v1/info"),
      { signal },
    );
  } catch {
    throw new Error("PLATFORM_UNREACHABLE");
  }
  if (!response.ok) throw new Error("PLATFORM_NOT_FOUND");
  const body = (await response.json().catch(() => null)) as {
    deploymentModes?: unknown;
  } | null;
  const modes = body?.deploymentModes;
  if (!Array.isArray(modes) || modes.length === 0) {
    throw new Error("PLATFORM_NOT_FOUND");
  }
  return modes.includes("managed") ? "managed" : "self_hosted";
}

/**
 * Answers who is signed in on this partition. In managed mode the platform
 * scopes the reply to the organization that owns the request host, so the
 * list holds exactly one entry.
 */
export async function platformIdentity(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<PlatformIdentity> {
  const response = await platformFetch(
    platformUrl(baseUrl, "api/platform/v1/auth/session"),
    { signal },
  );
  if (response.status === 401) throw new Error("PLATFORM_SIGNED_OUT");
  if (response.status === 403) throw new Error("ORGANIZATION_HOST_MISMATCH");
  if (!response.ok) throw new Error(`PLATFORM_SESSION_${response.status}`);
  const body = (await response.json()) as {
    accountId?: unknown;
    organizations?: unknown;
  };
  if (
    typeof body.accountId !== "string" ||
    !Array.isArray(body.organizations)
  ) {
    throw new Error("PLATFORM_SESSION_INVALID");
  }
  const organizations = body.organizations.flatMap((entry) => {
    const candidate = entry as Partial<PlatformOrganization>;
    return typeof candidate.slug === "string"
      ? [
          {
            id: String(candidate.id ?? candidate.slug),
            slug: candidate.slug,
            displayName: candidate.displayName ?? candidate.slug,
            role: candidate.role ?? "member",
          },
        ]
      : [];
  });
  if (organizations.length === 0) throw new Error("PLATFORM_NO_ORGANIZATION");
  return { accountId: body.accountId, organizations };
}

export async function platformLogout(baseUrl: string): Promise<void> {
  try {
    await platformFetch(platformUrl(baseUrl, "api/platform/v1/auth/logout"), {
      method: "POST",
    });
  } catch {
    // Signing out locally matters more than telling the server about it.
  }
  await platformSession().clearStorageData({ storages: ["cookies"] });
}

/**
 * Opens a window on the platform's own login route and resolves once the
 * session cookie is in the partition. Which identity provider appears is the
 * operator's business; Radius only waits for the outcome.
 */
export async function signInToPlatform(baseUrl: string): Promise<void> {
  const base = validatedPlatformUrl(baseUrl);
  const loginUrl = new URL("login?return_to=/workspace", base);
  const workspacePath = new URL("workspace", base).pathname;

  const authWindow = new BrowserWindow({
    width: 480,
    height: 720,
    title: "Sign in to Radius",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: PLATFORM_PARTITION,
    },
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    // A host that does not serve login redirects away from it, so never
    // reaching a page on this origin means the address is wrong rather than
    // the user having cancelled.
    let sawPlatformPage = false;
    let checking = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!authWindow.isDestroyed()) authWindow.close();
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(
      () => finish(new Error("PLATFORM_AUTH_TIMEOUT")),
      SIGN_IN_TIMEOUT_MS,
    );
    authWindow.on("closed", () =>
      finish(
        new Error(
          sawPlatformPage
            ? "PLATFORM_AUTH_CANCELLED"
            : "PLATFORM_SIGN_IN_UNAVAILABLE",
        ),
      ),
    );
    authWindow.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: "deny" };
    });
    // Navigation is deliberately unrestricted: an external identity provider
    // is a normal part of the flow, and sending it to a browser would land
    // the resulting cookie in the wrong session.

    const completeIfSignedIn = async (url: string): Promise<void> => {
      if (settled || checking) return;
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        return;
      }
      if (target.origin !== base.origin) return;
      sawPlatformPage = true;
      if (target.pathname !== workspacePath) return;

      checking = true;
      try {
        await platformIdentity(base.toString());
        finish();
      } catch (error) {
        // Landing on the workspace without a session means the platform
        // bounced the request; leave the window open so login can finish.
        if (error instanceof Error && error.message !== "PLATFORM_SIGNED_OUT") {
          finish(error);
        }
      } finally {
        checking = false;
      }
    };

    authWindow.webContents.on("did-navigate", (_event, url) => {
      void completeIfSignedIn(url);
    });
    authWindow.webContents.on("did-navigate-in-page", (_event, url) => {
      void completeIfSignedIn(url);
    });
    void authWindow.loadURL(loginUrl.toString()).catch((error: unknown) => {
      finish(
        error instanceof Error ? error : new Error("PLATFORM_AUTH_LOAD_FAILED"),
      );
    });
  });
}
