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
  const window = new BrowserWindow({
    width: 520,
    height: 760,
    title: "Connect to Curve Cloud",
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
          case "signed-out":
            onProgress("Waiting for you to sign in to Curve Cloud.");
            return;
          case "no-organization":
            onProgress("Waiting for you to create an organization.");
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
