import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
  systemPreferences,
} from "electron";
import path from "node:path";

import { DESKTOP_UPDATE_CHANNELS } from "../update-types";
import { AGENTS_CHANGED_CHANNEL } from "../radius-api";
import { initializeBundledAgents } from "./bundled-agents";
import {
  initializeDevelopmentAgentConnections,
  stopDevelopmentAgentConnections,
} from "./development-agents";
import {
  cancelAgentSession,
  connectAgentAuthentication,
  disconnectAgentAuthentication,
  getDesktopRuntimeStatus,
  listDesktopAgents,
  resolveToolApproval,
  startAgentPrompt,
  stopAgentRuntime,
} from "./agent-runtime";
import { closeStorage, initializeStorage } from "./storage";
import { reportPlatformClientInstallation } from "./platform-reporting";
import {
  addProjectFolderForRenderer,
  chooseProjectFolderForRenderer,
  createProjectFromRenderer,
  discardProjectFolderSelection,
  listProjectSidebar,
  listRecentSidebar,
  listSessionTranscriptForRenderer,
  removeProjectFolderForRenderer,
  renameProjectFromRenderer,
  renameSessionFromRenderer,
  revealProjectInFinder,
  setSessionPinnedFromRenderer,
  setSessionArchivedFromRenderer,
} from "./projects";
import { initializeScheduler, stopScheduler } from "./scheduler";
import { showNativeControlMenuForRenderer } from "./native-control-menu";
import {
  resolveMarkdownLinkPreview,
  resolveMarkdownMedia,
} from "./markdown-resource";
import {
  clearComposerDraftForRenderer,
  getComposerDraftForRenderer,
  saveComposerDraftForRenderer,
} from "./composer-drafts";
import { resolveSessionArtifactImage } from "./session-artifacts";
import { openSessionFile } from "./session-file-links";
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
  connectConnectorForRenderer,
  deleteConnectorForRenderer,
  disconnectConnectorForRenderer,
  initializeConnectorRegistry,
  installConnectorForRenderer,
  listMcpApprovalsForRenderer,
  listConnectorToolsForRenderer,
  listConnectorsForRenderer,
  revokeMcpApprovalForRenderer,
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
      scrollBounce:
        process.platform === "darwin" &&
        !systemPreferences.getAnimationSettings().prefersReducedMotion,
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
    ipcMain.handle("radius:handle-titlebar-double-click", (event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return;

      if (process.platform === "darwin") {
        const action = systemPreferences.getUserDefault(
          "AppleActionOnDoubleClick",
          "string",
        );
        const usesLegacyMinimizePreference =
          !action &&
          systemPreferences.getUserDefault(
            "AppleMiniaturizeOnDoubleClick",
            "boolean",
          );

        if (action === "None") return;
        if (action === "Minimize" || usesLegacyMinimizePreference) {
          window.minimize();
          return;
        }
      }

      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    });
    ipcMain.handle(
      "radius:show-native-control-menu",
      showNativeControlMenuForRenderer,
    );
    ipcMain.handle("radius:write-clipboard-text", (_event, text) => {
      if (typeof text !== "string") {
        throw new TypeError("CLIPBOARD_TEXT_INVALID");
      }
      clipboard.writeText(text);
    });
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
    ipcMain.handle("radius:get-composer-draft", (_event, context) =>
      getComposerDraftForRenderer(context),
    );
    ipcMain.handle("radius:save-composer-draft", (_event, input) =>
      saveComposerDraftForRenderer(input),
    );
    ipcMain.handle("radius:clear-composer-draft", (_event, context) =>
      clearComposerDraftForRenderer(context),
    );
    ipcMain.handle(
      "radius:choose-project-folder",
      chooseProjectFolderForRenderer,
    );
    ipcMain.handle("radius:create-project", createProjectFromRenderer);
    ipcMain.handle(
      "radius:discard-project-folder-selection",
      discardProjectFolderSelection,
    );
    ipcMain.handle("radius:add-project-folder", addProjectFolderForRenderer);
    ipcMain.handle(
      "radius:remove-project-folder",
      removeProjectFolderForRenderer,
    );
    ipcMain.handle("radius:rename-project", renameProjectFromRenderer);
    ipcMain.handle("radius:rename-session", renameSessionFromRenderer);
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
    ipcMain.handle("radius:list-connector-catalog", (_event, query) =>
      listConnectorCatalogForRenderer(query),
    );
    ipcMain.handle("radius:install-catalog-connector", (_event, id) =>
      installCatalogConnectorForRenderer(id),
    );
    ipcMain.handle("radius:install-connector", (_event, input) =>
      installConnectorForRenderer(input),
    );
    ipcMain.handle("radius:connect-connector", (_event, installationId) =>
      connectConnectorForRenderer(installationId),
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
    ipcMain.handle("radius:resolve-tool-approval", (_event, input) =>
      resolveToolApproval(input),
    );
    ipcMain.handle("radius:list-mcp-approval-grants", () =>
      listMcpApprovalsForRenderer(),
    );
    ipcMain.handle("radius:revoke-mcp-approval", (_event, input) =>
      revokeMcpApprovalForRenderer(input),
    );
    ipcMain.handle("radius:resolve-markdown-media", (_event, url) =>
      resolveMarkdownMedia(url),
    );
    ipcMain.handle("radius:resolve-markdown-link-preview", (_event, url) =>
      resolveMarkdownLinkPreview(url),
    );
    ipcMain.handle("radius:resolve-session-artifact-image", (_event, input) =>
      resolveSessionArtifactImage(input),
    );
    ipcMain.handle("radius:open-session-file", (_event, input) =>
      openSessionFile(input),
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
    await initializeDevelopmentAgentConnections(() => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(AGENTS_CHANGED_CHANNEL);
      }
    });
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
  stopDevelopmentAgentConnections();
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
