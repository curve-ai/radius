import { app, BrowserWindow } from "electron";
import { access } from "node:fs/promises";
import path from "node:path";
import type { AppUpdater, ProgressInfo, UpdateInfo } from "electron-updater";

import {
  DESKTOP_UPDATE_CHANNELS,
  desktopUpdateStatusesEqual,
  normalizeUpdatePercent,
  type DesktopUpdateStatus,
} from "../update-types";

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let updater: AppUpdater | null = null;
let updateCheckTimer: ReturnType<typeof setInterval> | null = null;
let stopping = false;
let status: DesktopUpdateStatus = {
  state: "unsupported",
  currentVersion: app.getVersion(),
  availableVersion: null,
  percent: null,
  errorCode: null,
};

function broadcastStatus(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send(DESKTOP_UPDATE_CHANNELS.changed, status);
    }
  }
}

function setStatus(next: DesktopUpdateStatus): void {
  if (desktopUpdateStatusesEqual(status, next)) return;
  status = next;
  broadcastStatus();
}

function statusFor(
  state: DesktopUpdateStatus["state"],
  options: Partial<
    Pick<DesktopUpdateStatus, "availableVersion" | "percent" | "errorCode">
  > = {},
): DesktopUpdateStatus {
  return {
    state,
    currentVersion: app.getVersion(),
    availableVersion: options.availableVersion ?? null,
    percent: options.percent ?? null,
    errorCode: options.errorCode ?? null,
  };
}

function releaseVersion(info: UpdateInfo): string {
  return info.version.trim() || "New version";
}

function handleUpdaterError(error: Error): void {
  if (status.state === "error") return;
  if (error.message.includes("No published versions on GitHub")) {
    setStatus(statusFor("idle"));
    return;
  }

  console.error("[updater] Radius update failed", error);
  setStatus(
    statusFor("error", {
      availableVersion: status.availableVersion,
      errorCode: "UPDATE_FAILED",
    }),
  );
}

async function checkForUpdate(): Promise<void> {
  if (
    !updater ||
    status.state === "downloading" ||
    status.state === "downloaded"
  ) {
    return;
  }

  try {
    await updater.checkForUpdates();
  } catch (error) {
    handleUpdaterError(
      error instanceof Error ? error : new Error("Unknown update error"),
    );
  }
}

export function getDesktopUpdateStatus(): DesktopUpdateStatus {
  return status;
}

export function checkDesktopUpdate(): DesktopUpdateStatus {
  void checkForUpdate();
  return status;
}

export function performDesktopUpdate(): DesktopUpdateStatus {
  if (!updater) return status;

  if (status.state === "downloaded") {
    updater.quitAndInstall(false, true);
    return status;
  }

  if (status.state !== "available") return status;

  setStatus(
    statusFor("downloading", {
      availableVersion: status.availableVersion,
      percent: 0,
    }),
  );
  void updater.downloadUpdate().catch((error: unknown) => {
    handleUpdaterError(
      error instanceof Error ? error : new Error("Unknown update error"),
    );
  });
  return status;
}

export function initializeDesktopUpdater(): void {
  stopping = false;
  status = statusFor("unsupported");
  if (!app.isPackaged) return;

  void initializePackagedUpdater();
}

async function initializePackagedUpdater(): Promise<void> {
  try {
    await access(path.join(process.resourcesPath, "app-update.yml"));
  } catch {
    return;
  }

  const { default: electronUpdater } = await import("electron-updater");
  if (stopping) return;

  const { autoUpdater, NoOpLogger } = electronUpdater;
  updater = autoUpdater;
  updater.logger = new NoOpLogger();
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.allowDowngrade = false;
  updater.allowPrerelease = false;
  setStatus(statusFor("idle"));

  updater.on("checking-for-update", () => {
    if (status.state !== "available") setStatus(statusFor("checking"));
  });
  updater.on("update-available", (info) => {
    setStatus(
      statusFor("available", {
        availableVersion: releaseVersion(info),
      }),
    );
  });
  updater.on("update-not-available", () => {
    setStatus(statusFor("idle"));
  });
  updater.on("download-progress", (progress: ProgressInfo) => {
    setStatus(
      statusFor("downloading", {
        availableVersion: status.availableVersion,
        percent: normalizeUpdatePercent(progress.percent),
      }),
    );
  });
  updater.on("update-downloaded", (info) => {
    setStatus(
      statusFor("downloaded", {
        availableVersion: releaseVersion(info),
        percent: 100,
      }),
    );
  });
  updater.on("update-cancelled", () => {
    setStatus(
      statusFor("available", {
        availableVersion: status.availableVersion,
      }),
    );
  });
  updater.on("error", handleUpdaterError);

  void checkForUpdate();
  updateCheckTimer = setInterval(
    () => void checkForUpdate(),
    UPDATE_CHECK_INTERVAL_MS,
  );
  updateCheckTimer.unref();
}

export function stopDesktopUpdater(): void {
  stopping = true;
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  updateCheckTimer = null;
}
