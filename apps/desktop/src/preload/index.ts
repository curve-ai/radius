import {
  CHAT_WINDOWS_CHANNEL,
  CHAT_WINDOW_REQUEST_CHANNEL,
  type ChatWindowApi,
} from "../chat-window-types";
import { contextBridge, ipcRenderer } from "electron";

import {
  DESKTOP_UPDATE_CHANNELS,
  type DesktopUpdateStatus,
} from "../update-types";
import {
  AGENTS_CHANGED_CHANNEL,
  SESSION_TRANSCRIPT_STREAM_CHANNEL,
  SESSION_WORKING_STATE_CHANNEL,
  type RadiusApi,
  type ComposerDraftContext,
  type GetAgentSessionFeaturesInput,
  type ResolveAgentElicitationInput,
  type SaveComposerDraftInput,
  type SetAgentSessionConfigOptionInput,
  type SetAgentSessionModeInput,
  type SessionTranscriptStreamUpdate,
  type SessionWorkingStateUpdate,
} from "../radius-api";
import type { DesktopConnectorCatalogQuery } from "../radius-api";
import type { NativeControlMenuInput } from "../radius-api";
import type { StartAgentPromptInput } from "../radius-api";
import type { ResolveToolApprovalInput } from "../radius-api";

const chatWindowListener = <T>(
  channel: string,
  listener: (value: T) => void,
): (() => void) => {
  const handler = (_event: Electron.IpcRendererEvent, value: T): void =>
    listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
const chatWindows: ChatWindowApi = {
  beginRename: (id) => ipcRenderer.invoke("radius:chat-window-rename", id),
  onRename: (listener) =>
    chatWindowListener("radius:chat-window-rename", listener),
  state: () => ipcRenderer.invoke("radius:chat-window-state"),
  restoreViews: () => ipcRenderer.invoke("radius:chat-window-restore-views"),
  onChanged: (listener) => chatWindowListener(CHAT_WINDOWS_CHANNEL, listener),
  onRequest: (listener) =>
    chatWindowListener(CHAT_WINDOW_REQUEST_CHANNEL, listener),
  onError: (listener) =>
    chatWindowListener("radius:chat-window-error", listener),
  onNavigateMain: (listener) =>
    chatWindowListener("radius:chat-main-navigate", listener),
  reply: (id, result) =>
    ipcRenderer.invoke("radius:chat-window-reply", id, result),
  move: (id, windowId) =>
    ipcRenderer.invoke("radius:chat-window-move", id, windowId),
  detach: (id) => ipcRenderer.invoke("radius:chat-window-detach", id),
  reorder: (id, direction) =>
    ipcRenderer.invoke("radius:chat-window-reorder", id, direction),
  close: (id) => ipcRenderer.invoke("radius:chat-window-close", id),
  bringBack: (id) => ipcRenderer.invoke("radius:chat-window-bring-back", id),
  focus: (id) => ipcRenderer.invoke("radius:chat-window-focus", id),
  select: (id) => ipcRenderer.invoke("radius:chat-window-select", id),
  openMain: (view) => ipcRenderer.invoke("radius:chat-window-open-main", view),
  setDropZone: (zone) =>
    ipcRenderer.invoke("radius:chat-window-drop-zone", zone),
  beginDrag: (id, token) =>
    ipcRenderer.invoke("radius:chat-window-drag-begin", id, token),
  endDrag: (token, cancelled) =>
    ipcRenderer.invoke("radius:chat-window-drag-end", token, cancelled),
};

const radiusApi = {
  chatWindows,
  authenticationStatus: () => ipcRenderer.invoke("radius:auth-status"),
  signIn: () => ipcRenderer.invoke("radius:auth-sign-in"),
  signOut: () => ipcRenderer.invoke("radius:auth-sign-out"),
  cancelSignIn: () => ipcRenderer.invoke("radius:auth-cancel"),
  platform: process.platform,
  handleTitlebarDoubleClick: () =>
    ipcRenderer.invoke("radius:handle-titlebar-double-click"),
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
  getComposerDraft: (context: ComposerDraftContext) =>
    ipcRenderer.invoke("radius:get-composer-draft", context),
  getComposerState: (context) =>
    ipcRenderer.invoke("radius:get-composer-state", context),
  getComposerAccessMode: (context) =>
    ipcRenderer.invoke("radius:get-composer-access-mode", context),
  setComposerAccessMode: (context, mode) =>
    ipcRenderer.invoke("radius:set-composer-access-mode", { context, mode }),
  addComposerAttachments: (input) =>
    ipcRenderer.invoke("radius:add-composer-attachments", input),
  removeComposerAttachment: (context, attachmentId) =>
    ipcRenderer.invoke("radius:remove-composer-attachment", {
      context,
      attachmentId,
    }),
  onComposerStateChanged: (listener) =>
    chatWindowListener("radius:composer-state-changed", listener),
  saveComposerDraft: (input: SaveComposerDraftInput) =>
    ipcRenderer.invoke("radius:save-composer-draft", input),
  clearComposerDraft: (context: ComposerDraftContext) =>
    ipcRenderer.invoke("radius:clear-composer-draft", context),
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
  onSessionWorkingStateChanged: (
    listener: (update: SessionWorkingStateUpdate) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      update: SessionWorkingStateUpdate,
    ): void => listener(update);
    ipcRenderer.on(SESSION_WORKING_STATE_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(SESSION_WORKING_STATE_CHANNEL, handler);
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
  connectConnector: (installationId: string) =>
    ipcRenderer.invoke("radius:connect-connector", installationId),
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
  getAgentSessionFeatures: (input: GetAgentSessionFeaturesInput) =>
    ipcRenderer.invoke("radius:get-agent-session-features", input),
  setAgentSessionConfigOption: (input: SetAgentSessionConfigOptionInput) =>
    ipcRenderer.invoke("radius:set-agent-session-config-option", input),
  setAgentSessionMode: (input: SetAgentSessionModeInput) =>
    ipcRenderer.invoke("radius:set-agent-session-mode", input),
  startAgentPrompt: (input: StartAgentPromptInput) =>
    ipcRenderer.invoke("radius:start-agent-prompt", input),
  resolveToolApproval: (input: ResolveToolApprovalInput) =>
    ipcRenderer.invoke("radius:resolve-tool-approval", input),
  listPendingAgentElicitations: (sessionId: string) =>
    ipcRenderer.invoke("radius:list-pending-agent-elicitations", sessionId),
  resolveAgentElicitation: (input: ResolveAgentElicitationInput) =>
    ipcRenderer.invoke("radius:resolve-agent-elicitation", input),
  listMcpApprovalGrants: () =>
    ipcRenderer.invoke("radius:list-mcp-approval-grants"),
  revokeMcpApproval: (input: { grantId: string; scope: "server" | "tool" }) =>
    ipcRenderer.invoke("radius:revoke-mcp-approval", input),
  resolveMarkdownMedia: (url: string) =>
    ipcRenderer.invoke("radius:resolve-markdown-media", url),
  resolveMarkdownLinkPreview: (url: string) =>
    ipcRenderer.invoke("radius:resolve-markdown-link-preview", url),
  openSessionFile: (input: { href: string; sessionId: string }) =>
    ipcRenderer.invoke("radius:open-session-file", input),
  resolveSessionArtifactImage: (input: {
    sessionId: string;
    artifactId: string;
  }) => ipcRenderer.invoke("radius:resolve-session-artifact-image", input),
  cancelAgentSession: (sessionId: string) =>
    ipcRenderer.invoke("radius:cancel-agent-session", sessionId),
  syncStatus: () => ipcRenderer.invoke("radius:sync-status"),
  syncNow: () => ipcRenderer.invoke("radius:sync-now"),
  setSyncEnabled: (enabled: boolean) =>
    ipcRenderer.invoke("radius:set-sync-enabled", enabled),
  connectPlatform: (
    input: { kind: "cloud" } | { kind: "self-hosted"; url: string },
  ) => ipcRenderer.invoke("radius:connect-platform", input),
  disconnectPlatform: () => ipcRenderer.invoke("radius:disconnect-platform"),
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
