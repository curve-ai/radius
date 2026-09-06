import { BrowserWindow, shell } from "electron";

import { readCloudSetupState, type CloudWorkspace } from "./cloud-setup-state";
import { PLATFORM_PARTITION, platformFetch } from "./platform-connection";
import { validatedPlatformUrl } from "./platform-endpoint";

export { organizationBaseUrl, readCloudSetupState } from "./cloud-setup-state";
export type { CloudWorkspace } from "./cloud-setup-state";

const POLL_INTERVAL_MS = 3_000;
const SETUP_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Opens the Cloud onboarding page and waits for a workspace to exist and
 * finish provisioning. The user may be signing in, creating an organization,
 * or waiting on setup; all three look the same from here, which is why this
 * polls rather than watching for one particular navigation.
 */
export async function connectViaCloud(
  cloudUrl: string,
  onProgress: (message: string) => void = () => {},
): Promise<CloudWorkspace> {
  const cloud = validatedPlatformUrl(cloudUrl);
  const onboarding = new URL("onboarding", cloud);

  // Someone reconnecting is usually still signed in and already has a
  // workspace, in which case there is nothing to ask and no reason to open a
  // window at all.
  const existing = await readCloudSetupState(cloud.toString(), platformFetch);
  if (existing.status === "ready") return existing.workspace;

  const window = new BrowserWindow({
    width: 520,
    height: 760,
    title: "Connect to Curve Cloud",
    // Shown only once the poll finds something a person has to do. Waiting on
    // provisioning is not one of those things: the app reports that itself.
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: PLATFORM_PARTITION,
    },
  });

  return new Promise<CloudWorkspace>((resolve, reject) => {
    let settled = false;
    let polling = false;
    const finish = (error: Error | null, workspace?: CloudWorkspace): void => {
      if (settled) return;
      settled = true;
      clearInterval(handle);
      clearTimeout(timeout);
      if (!window.isDestroyed()) window.close();
      if (error) reject(error);
      else resolve(workspace!);
    };

    const timeout = setTimeout(
      () => finish(new Error("CLOUD_SETUP_TIMEOUT")),
      SETUP_TIMEOUT_MS,
    );
    const reveal = (): void => {
      if (settled || window.isDestroyed() || window.isVisible()) return;
      window.show();
    };
    window.on("closed", () => finish(new Error("PLATFORM_AUTH_CANCELLED")));
    window.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: "deny" };
    });

    const poll = async (): Promise<void> => {
      if (settled || polling) return;
      polling = true;
      try {
        const state = await readCloudSetupState(
          cloud.toString(),
          platformFetch,
        );
        switch (state.status) {
          case "unavailable":
            // A blip must not end a flow the user is halfway through, and it
            // is not a reason to ask them to sign in again.
            onProgress("Waiting for Curve Cloud to respond…");
            return;
          case "signed-out":
            onProgress("Waiting for you to sign in to Curve Cloud.");
            reveal();
            return;
          case "no-organization":
            onProgress("Waiting for you to create an organization.");
            reveal();
            return;
          case "provisioning":
            onProgress("Setting up your workspace…");
            return;
          case "failed":
            finish(
              new Error(`CLOUD_SETUP_${state.lifecycleState.toUpperCase()}`),
            );
            return;
          case "ready":
            finish(null, state.workspace);
        }
      } catch (error) {
        finish(
          error instanceof Error ? error : new Error("CLOUD_SETUP_FAILED"),
        );
      } finally {
        polling = false;
      }
    };

    const handle = setInterval(() => void poll(), POLL_INTERVAL_MS);
    void window.loadURL(onboarding.toString()).then(
      () => void poll(),
      (error: unknown) =>
        finish(
          error instanceof Error
            ? error
            : new Error("PLATFORM_AUTH_LOAD_FAILED"),
        ),
    );
  });
}
