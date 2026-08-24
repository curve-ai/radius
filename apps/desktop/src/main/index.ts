import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
} from "electron";
import path from "node:path";

import { DESKTOP_UPDATE_CHANNELS } from "../update-types";
import { closeStorage, initializeStorage } from "./storage";
import {
  chooseProjectFolderForRenderer,
  createProjectFromSelection,
  discardProjectFolderSelection,
  listProjectSidebar,
  listRecentSidebar,
  renameProjectFromRenderer,
  revealProjectInFinder,
  relinkProjectFolder,
  setSessionPinnedFromRenderer,
} from "./projects";
import { initializeScheduler, stopScheduler } from "./scheduler";
import {
  connectCloud,
  getSyncStatus,
  initializeSync,
  runSyncNow,
  setSyncEnabled,
  stopSync,
} from "./sync";
import {
  getDesktopUpdateStatus,
  initializeDesktopUpdater,
  performDesktopUpdate,
  stopDesktopUpdater,
} from "./updater";

const requestedUserDataPath = process.env.RADIUS_USER_DATA_PATH?.trim();
if (requestedUserDataPath) {
  app.setPath("userData", path.resolve(requestedUserDataPath));
}

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: "Radius",
    titleBarStyle: "hiddenInset",
    trafficLightPosition:
      process.platform === "darwin" ? { x: 17, y: 16 } : undefined,
    transparent: process.platform === "darwin",
    backgroundColor: "#00000000",
    vibrancy: process.platform === "darwin" ? "sidebar" : undefined,
    visualEffectState: "followWindow",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  app.setAppUserModelId("ai.curve.radius");
  try {
    const storageContext = await initializeStorage();
    ipcMain.handle("radius:storage-status", () => ({ ready: true as const }));
    ipcMain.handle("radius:set-native-theme", (_event, preference) => {
      if (
        preference !== "system" &&
        preference !== "light" &&
        preference !== "dark"
      ) {
        return false;
      }
      nativeTheme.themeSource = preference;
      return nativeTheme.shouldUseDarkColors;
    });
    ipcMain.handle("radius:list-projects", listProjectSidebar);
    ipcMain.handle("radius:list-recent-sessions", listRecentSidebar);
    ipcMain.handle(
      "radius:choose-project-folder",
      chooseProjectFolderForRenderer,
    );
    ipcMain.handle("radius:create-project", createProjectFromSelection);
    ipcMain.handle(
      "radius:discard-project-folder-selection",
      discardProjectFolderSelection,
    );
    ipcMain.handle("radius:relink-project", relinkProjectFolder);
    ipcMain.handle("radius:rename-project", renameProjectFromRenderer);
    ipcMain.handle("radius:reveal-project", revealProjectInFinder);
    ipcMain.handle("radius:set-session-pinned", setSessionPinnedFromRenderer);
    ipcMain.handle("radius:sync-status", getSyncStatus);
    ipcMain.handle("radius:sync-now", runSyncNow);
    ipcMain.handle("radius:set-sync-enabled", (_event, enabled) =>
      setSyncEnabled(enabled === true),
    );
    ipcMain.handle("radius:connect-cloud", (_event, input) =>
      connectCloud(input),
    );
    ipcMain.handle(DESKTOP_UPDATE_CHANNELS.status, getDesktopUpdateStatus);
    ipcMain.handle(DESKTOP_UPDATE_CHANNELS.perform, performDesktopUpdate);
    createWindow();
    initializeDesktopUpdater();
    void initializeScheduler(storageContext).catch((error) => {
      console.error(
        "[scheduler] Radius could not initialize scheduling",
        error,
      );
    });
    void initializeSync(storageContext).catch((error) => {
      console.error(
        "[sync] Radius could not initialize synchronization",
        error,
      );
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown storage error";
    console.error("[storage] Radius could not open local storage", error);
    dialog.showErrorBox("Radius could not open local storage", message);
    app.quit();
  }
});

let shutdownStarted = false;
app.on("before-quit", (event) => {
  if (shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  stopDesktopUpdater();
  void Promise.allSettled([stopScheduler(), stopSync()]).finally(() => {
    closeStorage();
    app.quit();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
