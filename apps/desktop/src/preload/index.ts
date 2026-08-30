import { contextBridge, ipcRenderer } from "electron";

import {
  DESKTOP_UPDATE_CHANNELS,
  type DesktopUpdateStatus,
} from "../update-types";
import {
  AGENTS_CHANGED_CHANNEL,
  SESSION_TRANSCRIPT_STREAM_CHANNEL,
  type RadiusApi,
  type SessionTranscriptStreamUpdate,
} from "../radius-api";
import type { BrowserConnectionStatus } from "../radius-api";
import type { DesktopConnectorCatalogQuery } from "../radius-api";
import type { NativeControlMenuInput } from "../radius-api";
import type { StartAgentPromptInput } from "../radius-api";
import type { ResolveTerminalApprovalInput } from "../radius-api";

const radiusApi = {
  platform: process.platform,
  setNativeTheme: (preference: "system" | "light" | "dark") =>
    ipcRenderer.invoke("radius:set-native-theme", preference),
  showNativeControlMenu: (input: NativeControlMenuInput) =>
    ipcRenderer.invoke("radius:show-native-control-menu", input),
  writeClipboardText: (text: string) =>
    ipcRenderer.invoke("radius:write-clipboard-text", text),
  storageStatus: () => ipcRenderer.invoke("radius:storage-status"),
  listProjects: () => ipcRenderer.invoke("radius:list-projects"),
  listRecentSessions: () => ipcRenderer.invoke("radius:list-recent-sessions"),
  listSessionTranscript: (sessionId: string) =>
    ipcRenderer.invoke("radius:list-session-transcript", sessionId),
  onSessionTranscriptStream: (
    listener: (update: SessionTranscriptStreamUpdate) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      update: SessionTranscriptStreamUpdate,
    ): void => listener(update);
    ipcRenderer.on(SESSION_TRANSCRIPT_STREAM_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(SESSION_TRANSCRIPT_STREAM_CHANNEL, handler);
  },
  chooseProjectFolder: () => ipcRenderer.invoke("radius:choose-project-folder"),
  createProject: (input: { selectionIds?: string[]; name: string }) =>
    ipcRenderer.invoke("radius:create-project", input),
  discardProjectFolderSelection: (selectionId: string) =>
    ipcRenderer.invoke("radius:discard-project-folder-selection", selectionId),
  addProjectFolder: (projectId: string) =>
    ipcRenderer.invoke("radius:add-project-folder", projectId),
  removeProjectFolder: (input: { projectId: string; rootId: string }) =>
    ipcRenderer.invoke("radius:remove-project-folder", input),
  renameProject: (input: { projectId: string; name: string }) =>
    ipcRenderer.invoke("radius:rename-project", input),
  renameSession: (input: { sessionId: string; title: string }) =>
    ipcRenderer.invoke("radius:rename-session", input),
  revealProject: (projectId: string) =>
    ipcRenderer.invoke("radius:reveal-project", projectId),
  setSessionPinned: (sessionId: string, pinned: boolean) =>
    ipcRenderer.invoke("radius:set-session-pinned", sessionId, pinned),
  setSessionArchived: (sessionId: string) =>
    ipcRenderer.invoke("radius:set-session-archived", sessionId),
  listConnectors: () => ipcRenderer.invoke("radius:list-connectors"),
  listConnectorTools: (installationId: string) =>
    ipcRenderer.invoke("radius:list-connector-tools", installationId),
  listConnectorCatalog: (query?: DesktopConnectorCatalogQuery) =>
    ipcRenderer.invoke("radius:list-connector-catalog", query),
  installCatalogConnector: (id: string) =>
    ipcRenderer.invoke("radius:install-catalog-connector", id),
  installConnector: (input: { name: string; url: string }) =>
    ipcRenderer.invoke("radius:install-connector", input),
  disconnectConnector: (providerId: string) =>
    ipcRenderer.invoke("radius:disconnect-connector", providerId),
  deleteConnector: (installationId: string) =>
    ipcRenderer.invoke("radius:delete-connector", installationId),
  listAgents: () => ipcRenderer.invoke("radius:list-agents"),
  onAgentsChanged: (listener: () => void) => {
    const handler = (): void => listener();
    ipcRenderer.on(AGENTS_CHANGED_CHANNEL, handler);
    return () => ipcRenderer.removeListener(AGENTS_CHANGED_CHANNEL, handler);
  },
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
  resolveTerminalApproval: (input: ResolveTerminalApprovalInput) =>
    ipcRenderer.invoke("radius:resolve-terminal-approval", input),
  resolveMarkdownMedia: (url: string) =>
    ipcRenderer.invoke("radius:resolve-markdown-media", url),
  resolveMarkdownLinkPreview: (url: string) =>
    ipcRenderer.invoke("radius:resolve-markdown-link-preview", url),
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
