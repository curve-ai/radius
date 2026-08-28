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
import { initializeBundledAgents } from "./bundled-agents";
import {
  cancelAgentSession,
  connectAgentAuthentication,
  disconnectAgentAuthentication,
  getDesktopRuntimeStatus,
  listDesktopAgents,
  startAgentPrompt,
  stopAgentRuntime,
} from "./agent-runtime";
import { closeStorage, initializeStorage } from "./storage";
import { reportPlatformClientInstallation } from "./platform-reporting";
import {
  chooseProjectFolderForRenderer,
  createProjectFromSelection,
  discardProjectFolderSelection,
  listProjectSidebar,
  listRecentSidebar,
  listSessionTranscriptForRenderer,
  renameProjectFromRenderer,
  revealProjectInFinder,
  relinkProjectFolder,
  setSessionPinnedFromRenderer,
  setSessionArchivedFromRenderer,
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
  checkDesktopUpdate,
  getDesktopUpdateStatus,
  initializeDesktopUpdater,
  performDesktopUpdate,
  stopDesktopUpdater,
} from "./updater";
import {
  deleteConnectorForRenderer,
  disconnectConnectorForRenderer,
  initializeConnectorRegistry,
  installConnectorForRenderer,
  listConnectorToolsForRenderer,
  listConnectorsForRenderer,
} from "./connectors";
import {
  installCatalogConnectorForRenderer,
  listConnectorCatalogForRenderer,
} from "./connector-catalog";
import {
  getBrowserConnectionStatus,
  initializeBrowserBridge,
  revealBrowserExtension,
  stopBrowserBridge,
} from "./browser-bridge";

const requestedUserDataPath = process.env.RADIUS_USER_DATA_PATH?.trim();
if (requestedUserDataPath) {
  app.setPath("userData", path.resolve(requestedUserDataPath));
}

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

app.on("second-instance", () => {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

const isSafeExternalUrl = (value: string): boolean => {
  const url = new URL(value);
  if (url.protocol === "https:") return true;

  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]")
  );
};

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 480,
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
    if (isSafeExternalUrl(url)) {
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
  if (!primaryInstance) return;
  app.setAppUserModelId("ai.curve.radius");
  try {
    const storageContext = await initializeStorage();
    void reportPlatformClientInstallation(storageContext).catch((error) => {
      console.error(
        "[platform] Radius could not report this client installation",
        error instanceof Error ? error.message : "PLATFORM_REPORT_FAILED",
      );
    });
    await initializeBundledAgents().catch((error) => {
      console.error("[agents] Radius could not prepare bundled agents", error);
    });
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
      "radius:list-session-transcript",
      listSessionTranscriptForRenderer,
    );
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
    ipcMain.handle(
      "radius:set-session-archived",
      setSessionArchivedFromRenderer,
    );
    ipcMain.handle("radius:list-connectors", listConnectorsForRenderer);
    ipcMain.handle("radius:list-connector-tools", (_event, installationId) =>
      listConnectorToolsForRenderer(installationId),
    );
    ipcMain.handle("radius:list-connector-catalog", (_event, search) =>
      listConnectorCatalogForRenderer(search),
    );
    ipcMain.handle("radius:install-catalog-connector", (_event, id) =>
      installCatalogConnectorForRenderer(id),
    );
    ipcMain.handle("radius:install-connector", (_event, input) =>
      installConnectorForRenderer(input),
    );
    ipcMain.handle("radius:disconnect-connector", (_event, providerId) =>
      disconnectConnectorForRenderer(providerId),
    );
    ipcMain.handle("radius:delete-connector", (_event, installationId) =>
      deleteConnectorForRenderer(installationId),
    );
    ipcMain.handle("radius:list-agents", listDesktopAgents);
    ipcMain.handle("radius:connect-agent-authentication", (_event, agentId) =>
      connectAgentAuthentication(typeof agentId === "string" ? agentId : ""),
    );
    ipcMain.handle(
      "radius:disconnect-agent-authentication",
      (_event, agentId) =>
        disconnectAgentAuthentication(
          typeof agentId === "string" ? agentId : "",
        ),
    );
    ipcMain.handle("radius:runtime-status", getDesktopRuntimeStatus);
    ipcMain.handle("radius:browser-status", getBrowserConnectionStatus);
    ipcMain.handle("radius:reveal-browser-extension", revealBrowserExtension);
    ipcMain.handle("radius:start-agent-prompt", (_event, input) =>
      startAgentPrompt(input),
    );
    ipcMain.handle("radius:cancel-agent-session", (_event, sessionId) =>
      cancelAgentSession(typeof sessionId === "string" ? sessionId : ""),
    );
    ipcMain.handle("radius:sync-status", getSyncStatus);
    ipcMain.handle("radius:sync-now", runSyncNow);
    ipcMain.handle("radius:set-sync-enabled", (_event, enabled) =>
      setSyncEnabled(enabled === true),
    );
    ipcMain.handle("radius:connect-cloud", (_event, input) =>
      connectCloud(input),
    );
    ipcMain.handle(DESKTOP_UPDATE_CHANNELS.status, getDesktopUpdateStatus);
    ipcMain.handle(DESKTOP_UPDATE_CHANNELS.check, checkDesktopUpdate);
    ipcMain.handle(DESKTOP_UPDATE_CHANNELS.perform, performDesktopUpdate);
    createWindow();
    void initializeBrowserBridge().catch((error) => {
      console.error(
        "[browser] Radius could not initialize the Chrome bridge",
        error,
      );
    });
    await initializeConnectorRegistry();
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
  stopAgentRuntime();
  void Promise.allSettled([
    stopBrowserBridge(),
    stopScheduler(),
    stopSync(),
  ]).finally(() => {
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
