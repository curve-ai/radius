import { mkdirSync } from "node:fs";
import { readDistribution } from "./distribution";
import {
  assertDesktopAuthenticated,
  cancelPlatformSignIn,
  desktopAuthenticationStatus,
  initializeDesktopAuthentication,
  signInToPlatform,
  signOutOfPlatform,
} from "./desktop-auth";
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
  getAgentSessionFeatures,
  listPendingAgentElicitations,
  listDesktopAgents,
  resolveToolApproval,
  resolveAgentElicitation,
  setAgentSessionConfigOption,
  setAgentSessionMode,
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
import { stopSync } from "./sync";
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

const distribution = readDistribution();
if (distribution) {
  const profile = path.join(
    app.getPath("appData"),
    `Radius-${distribution.id}`,
  );
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  app.setPath("userData", profile);
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

const publicChannels = new Set([
  "radius:auth-status",
  "radius:auth-sign-in",
  "radius:auth-sign-out",
  "radius:auth-cancel",
  "radius:handle-titlebar-double-click",
  "radius:set-native-theme",
  "radius:storage-status",
]);
const handleRadiusIpc: typeof ipcMain.handle = (channel, listener) => {
  ipcMain.handle(channel, (event, ...args) => {
    if (!publicChannels.has(channel)) assertDesktopAuthenticated();
    return listener(event, ...args);
  });
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
  app.setAppUserModelId(distribution?.id ?? "ai.curve.radius");
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
    handleRadiusIpc("radius:storage-status", () => ({ ready: true as const }));
    handleRadiusIpc("radius:handle-titlebar-double-click", (event) => {
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
    handleRadiusIpc(
      "radius:show-native-control-menu",
      showNativeControlMenuForRenderer,
    );
    handleRadiusIpc("radius:write-clipboard-text", (_event, text) => {
      if (typeof text !== "string") {
        throw new TypeError("CLIPBOARD_TEXT_INVALID");
      }
      clipboard.writeText(text);
    });
    handleRadiusIpc("radius:set-native-theme", (_event, preference) => {
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
    handleRadiusIpc("radius:list-projects", listProjectSidebar);
    handleRadiusIpc("radius:list-recent-sessions", listRecentSidebar);
    handleRadiusIpc(
      "radius:list-session-transcript",
      listSessionTranscriptForRenderer,
    );
    handleRadiusIpc("radius:get-composer-draft", (_event, context) =>
      getComposerDraftForRenderer(context),
    );
    handleRadiusIpc("radius:save-composer-draft", (_event, input) =>
      saveComposerDraftForRenderer(input),
    );
    handleRadiusIpc("radius:clear-composer-draft", (_event, context) =>
      clearComposerDraftForRenderer(context),
    );
    handleRadiusIpc(
      "radius:choose-project-folder",
      chooseProjectFolderForRenderer,
    );
    handleRadiusIpc("radius:create-project", createProjectFromRenderer);
    handleRadiusIpc(
      "radius:discard-project-folder-selection",
      discardProjectFolderSelection,
    );
    handleRadiusIpc("radius:add-project-folder", addProjectFolderForRenderer);
    handleRadiusIpc(
      "radius:remove-project-folder",
      removeProjectFolderForRenderer,
    );
    handleRadiusIpc("radius:rename-project", renameProjectFromRenderer);
    handleRadiusIpc("radius:rename-session", renameSessionFromRenderer);
    handleRadiusIpc("radius:reveal-project", revealProjectInFinder);
    handleRadiusIpc("radius:set-session-pinned", setSessionPinnedFromRenderer);
    handleRadiusIpc(
      "radius:set-session-archived",
      setSessionArchivedFromRenderer,
    );
    handleRadiusIpc("radius:list-connectors", listConnectorsForRenderer);
    handleRadiusIpc("radius:list-connector-tools", (_event, installationId) =>
      listConnectorToolsForRenderer(installationId),
    );
    handleRadiusIpc("radius:list-connector-catalog", (_event, query) =>
      listConnectorCatalogForRenderer(query),
    );
    handleRadiusIpc("radius:install-catalog-connector", (_event, id) =>
      installCatalogConnectorForRenderer(id),
    );
    handleRadiusIpc("radius:install-connector", (_event, input) =>
      installConnectorForRenderer(input),
    );
    handleRadiusIpc("radius:connect-connector", (_event, installationId) =>
      connectConnectorForRenderer(installationId),
    );
    handleRadiusIpc("radius:disconnect-connector", (_event, providerId) =>
      disconnectConnectorForRenderer(providerId),
    );
    handleRadiusIpc("radius:delete-connector", (_event, installationId) =>
      deleteConnectorForRenderer(installationId),
    );
    handleRadiusIpc("radius:list-agents", listDesktopAgents);
    handleRadiusIpc("radius:connect-agent-authentication", (_event, agentId) =>
      connectAgentAuthentication(typeof agentId === "string" ? agentId : ""),
    );
    handleRadiusIpc(
      "radius:disconnect-agent-authentication",
      (_event, agentId) =>
        disconnectAgentAuthentication(
          typeof agentId === "string" ? agentId : "",
        ),
    );
    handleRadiusIpc("radius:runtime-status", getDesktopRuntimeStatus);
    handleRadiusIpc("radius:get-agent-session-features", (_event, input) =>
      getAgentSessionFeatures(input),
    );
    handleRadiusIpc("radius:set-agent-session-config-option", (_event, input) =>
      setAgentSessionConfigOption(input),
    );
    handleRadiusIpc("radius:set-agent-session-mode", (_event, input) =>
      setAgentSessionMode(input),
    );
    handleRadiusIpc("radius:browser-status", getBrowserConnectionStatus);
    handleRadiusIpc("radius:reveal-browser-extension", revealBrowserExtension);
    handleRadiusIpc("radius:start-agent-prompt", (_event, input) =>
      startAgentPrompt(input),
    );
    handleRadiusIpc("radius:resolve-tool-approval", (_event, input) =>
      resolveToolApproval(input),
    );
    handleRadiusIpc(
      "radius:list-pending-agent-elicitations",
      (_event, sessionId) =>
        listPendingAgentElicitations(
          typeof sessionId === "string" ? sessionId : "",
        ),
    );
    handleRadiusIpc("radius:resolve-agent-elicitation", (_event, input) =>
      resolveAgentElicitation(input),
    );
    handleRadiusIpc("radius:list-mcp-approval-grants", () =>
      listMcpApprovalsForRenderer(),
    );
    handleRadiusIpc("radius:revoke-mcp-approval", (_event, input) =>
      revokeMcpApprovalForRenderer(input),
    );
    handleRadiusIpc("radius:resolve-markdown-media", (_event, url) =>
      resolveMarkdownMedia(url),
    );
    handleRadiusIpc("radius:resolve-markdown-link-preview", (_event, url) =>
      resolveMarkdownLinkPreview(url),
    );
    handleRadiusIpc("radius:resolve-session-artifact-image", (_event, input) =>
      resolveSessionArtifactImage(input),
    );
    handleRadiusIpc("radius:open-session-file", (_event, input) =>
      openSessionFile(input),
    );
    handleRadiusIpc("radius:cancel-agent-session", (_event, sessionId) =>
      cancelAgentSession(typeof sessionId === "string" ? sessionId : ""),
    );
    handleRadiusIpc(DESKTOP_UPDATE_CHANNELS.status, getDesktopUpdateStatus);
    handleRadiusIpc(DESKTOP_UPDATE_CHANNELS.check, checkDesktopUpdate);
    handleRadiusIpc(DESKTOP_UPDATE_CHANNELS.perform, performDesktopUpdate);
    handleRadiusIpc("radius:auth-status", desktopAuthenticationStatus);
    handleRadiusIpc("radius:auth-sign-in", signInToPlatform);
    handleRadiusIpc("radius:auth-sign-out", signOutOfPlatform);
    handleRadiusIpc("radius:auth-cancel", cancelPlatformSignIn);
    createWindow();
    void initializeDesktopAuthentication(stopAgentRuntime);
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
