import { contextBridge, ipcRenderer } from "electron";

import {
  DESKTOP_UPDATE_CHANNELS,
  type DesktopUpdateStatus,
} from "../update-types";
import type { RadiusApi } from "../radius-api";
import type { BrowserConnectionStatus } from "../radius-api";
import type { StartAgentPromptInput } from "../radius-api";

const radiusApi = {
  platform: process.platform,
  setNativeTheme: (preference: "system" | "light" | "dark") =>
    ipcRenderer.invoke("radius:set-native-theme", preference),
  storageStatus: () => ipcRenderer.invoke("radius:storage-status"),
  listProjects: () => ipcRenderer.invoke("radius:list-projects"),
  listRecentSessions: () => ipcRenderer.invoke("radius:list-recent-sessions"),
  listSessionTranscript: (sessionId: string) =>
    ipcRenderer.invoke("radius:list-session-transcript", sessionId),
  chooseProjectFolder: () => ipcRenderer.invoke("radius:choose-project-folder"),
  createProject: (input: { selectionId: string; name: string }) =>
    ipcRenderer.invoke("radius:create-project", input),
  discardProjectFolderSelection: (selectionId: string) =>
    ipcRenderer.invoke("radius:discard-project-folder-selection", selectionId),
  relinkProject: (projectId: string) =>
    ipcRenderer.invoke("radius:relink-project", projectId),
  renameProject: (input: { projectId: string; name: string }) =>
    ipcRenderer.invoke("radius:rename-project", input),
  revealProject: (projectId: string) =>
    ipcRenderer.invoke("radius:reveal-project", projectId),
  setSessionPinned: (sessionId: string, pinned: boolean) =>
    ipcRenderer.invoke("radius:set-session-pinned", sessionId, pinned),
  setSessionArchived: (sessionId: string) =>
    ipcRenderer.invoke("radius:set-session-archived", sessionId),
  listConnectors: () => ipcRenderer.invoke("radius:list-connectors"),
  listConnectorTools: (installationId: string) =>
    ipcRenderer.invoke("radius:list-connector-tools", installationId),
  listConnectorCatalog: (search?: string) =>
    ipcRenderer.invoke("radius:list-connector-catalog", search),
  installCatalogConnector: (id: string) =>
    ipcRenderer.invoke("radius:install-catalog-connector", id),
  installConnector: (input: { name: string; url: string }) =>
    ipcRenderer.invoke("radius:install-connector", input),
  disconnectConnector: (providerId: string) =>
    ipcRenderer.invoke("radius:disconnect-connector", providerId),
  deleteConnector: (installationId: string) =>
    ipcRenderer.invoke("radius:delete-connector", installationId),
  listAgents: () => ipcRenderer.invoke("radius:list-agents"),
  connectAgentAuthentication: (agentId: string) =>
    ipcRenderer.invoke("radius:connect-agent-authentication", agentId),
  disconnectAgentAuthentication: (agentId: string) =>
    ipcRenderer.invoke("radius:disconnect-agent-authentication", agentId),
  runtimeStatus: () => ipcRenderer.invoke("radius:runtime-status"),
  browserStatus: () => ipcRenderer.invoke("radius:browser-status"),
  revealBrowserExtension: () =>
    ipcRenderer.invoke("radius:reveal-browser-extension"),
  onBrowserStatus: (listener: (status: BrowserConnectionStatus) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      status: BrowserConnectionStatus,
    ): void => listener(status);
    ipcRenderer.on("radius:browser-status-changed", handler);
    return () =>
      ipcRenderer.removeListener("radius:browser-status-changed", handler);
  },
  startAgentPrompt: (input: StartAgentPromptInput) =>
    ipcRenderer.invoke("radius:start-agent-prompt", input),
  cancelAgentSession: (sessionId: string) =>
    ipcRenderer.invoke("radius:cancel-agent-session", sessionId),
  syncStatus: () => ipcRenderer.invoke("radius:sync-status"),
  syncNow: () => ipcRenderer.invoke("radius:sync-now"),
  setSyncEnabled: (enabled: boolean) =>
    ipcRenderer.invoke("radius:set-sync-enabled", enabled),
  connectCloud: (input: { frontendUrl: string; apiUrl: string }) =>
    ipcRenderer.invoke("radius:connect-cloud", input),
  updateStatus: () => ipcRenderer.invoke(DESKTOP_UPDATE_CHANNELS.status),
  checkForUpdates: () => ipcRenderer.invoke(DESKTOP_UPDATE_CHANNELS.check),
  performUpdate: () => ipcRenderer.invoke(DESKTOP_UPDATE_CHANNELS.perform),
  onUpdateStatus: (listener: (status: DesktopUpdateStatus) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      status: DesktopUpdateStatus,
    ): void => listener(status);
    ipcRenderer.on(DESKTOP_UPDATE_CHANNELS.changed, handler);
    return () =>
      ipcRenderer.removeListener(DESKTOP_UPDATE_CHANNELS.changed, handler);
  },
} satisfies RadiusApi;

contextBridge.exposeInMainWorld("radius", radiusApi);
