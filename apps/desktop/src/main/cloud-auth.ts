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
  signIn.searchParams.set("returnUrl", "/workspace");
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
    authWindow.on("closed", () => finish(new Error("CLOUD_AUTH_CANCELLED")));
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
    authWindow.webContents.on("did-navigate", async (_event, url) => {
      const target = new URL(url);
      if (
        target.origin !== frontend.origin ||
        target.pathname !== "/workspace"
      ) {
        return;
      }
      try {
        await getCloudAccessToken(frontend.toString());
        finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error("CLOUD_AUTH_FAILED"));
      }
    });
    void authWindow.loadURL(signIn.toString()).catch((error: unknown) => {
      finish(
        error instanceof Error ? error : new Error("CLOUD_AUTH_LOAD_FAILED"),
      );
    });
  });
}
