import { BrowserWindow, session as electronSession, shell } from "electron";

import { validatedCloudUrl } from "./cloud-url";

const CLOUD_AUTH_PARTITION = "persist:radius-cloud-auth";

export async function getCloudAccessToken(
  frontendUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const frontend = validatedCloudUrl(frontendUrl);
  const authSession = electronSession.fromPartition(CLOUD_AUTH_PARTITION);
  const response = await authSession.fetch(
    new URL("/api/auth/token", frontend).toString(),
    {
      credentials: "include",
      signal,
    },
  );
  if (!response.ok) throw new Error(`CLOUD_AUTH_TOKEN_${response.status}`);
  const value = (await response.json()) as { token?: unknown };
  if (typeof value.token !== "string" || value.token.length === 0) {
    throw new Error("CLOUD_AUTH_TOKEN_INVALID");
  }
  return value.token;
}

export async function authenticateCloud(frontendUrl: string): Promise<void> {
  const frontend = validatedCloudUrl(frontendUrl);
  const signIn = new URL("/sign-in", frontend);
  const authWindow = new BrowserWindow({
    width: 480,
    height: 720,
    title: "Connect Radius Cloud",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: CLOUD_AUTH_PARTITION,
    },
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    // A host that does not serve sign-in redirects away from it, so never
    // reaching the sign-in page means the address is wrong rather than the
    // user having cancelled.
    let sawSignInPage = false;
    let checkingToken = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!authWindow.isDestroyed()) authWindow.close();
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(
      () => finish(new Error("CLOUD_AUTH_TIMEOUT")),
      10 * 60 * 1000,
    );
    authWindow.on("closed", () =>
      finish(
        new Error(
          sawSignInPage
            ? "CLOUD_AUTH_CANCELLED"
            : "CLOUD_AUTH_SIGN_IN_UNAVAILABLE",
        ),
      ),
    );
    authWindow.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: "deny" };
    });
    authWindow.webContents.on("will-navigate", (event, url) => {
      const target = new URL(url);
      if (target.origin !== frontend.origin) {
        event.preventDefault();
        void shell.openExternal(url);
      }
    });
    // The Cloud application owns its own routing, so no single path can mean
    // "signed in". Ask the session itself after every navigation instead: a
    // token exists only once the sign-in completed.
    const completeIfAuthenticated = async (url: string): Promise<void> => {
      if (settled || checkingToken) return;

      let target: URL;
      try {
        target = new URL(url);
      } catch {
        return;
      }
      if (target.origin !== frontend.origin) return;
      if (target.pathname.startsWith("/sign-in")) sawSignInPage = true;

      checkingToken = true;
      try {
        await getCloudAccessToken(frontend.toString());
        finish();
      } catch {
        // Not signed in yet. Leave the window open so the user can continue;
        // rejecting here would abort on the sign-in page itself.
      } finally {
        checkingToken = false;
      }
    };

    authWindow.webContents.on("did-navigate", (_event, url) => {
      void completeIfAuthenticated(url);
    });
    // The Cloud application may transition client-side after sign-in without a
    // full navigation.
    authWindow.webContents.on("did-navigate-in-page", (_event, url) => {
      void completeIfAuthenticated(url);
    });
    void authWindow.loadURL(signIn.toString()).catch((error: unknown) => {
      finish(
        error instanceof Error ? error : new Error("CLOUD_AUTH_LOAD_FAILED"),
      );
    });
  });
}
