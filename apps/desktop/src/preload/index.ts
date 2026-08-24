import { contextBridge, ipcRenderer } from "electron";

import {
  DESKTOP_UPDATE_CHANNELS,
  type DesktopUpdateStatus,
} from "../update-types";
import type { RadiusApi } from "../radius-api";

const radiusApi = {
  platform: process.platform,
  setNativeTheme: (preference: "system" | "light" | "dark") =>
    ipcRenderer.invoke("radius:set-native-theme", preference),
  storageStatus: () => ipcRenderer.invoke("radius:storage-status"),
  listProjects: () => ipcRenderer.invoke("radius:list-projects"),
  listRecentSessions: () => ipcRenderer.invoke("radius:list-recent-sessions"),
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
  syncStatus: () => ipcRenderer.invoke("radius:sync-status"),
  syncNow: () => ipcRenderer.invoke("radius:sync-now"),
  setSyncEnabled: (enabled: boolean) =>
    ipcRenderer.invoke("radius:set-sync-enabled", enabled),
  connectCloud: (input: { frontendUrl: string; apiUrl: string }) =>
    ipcRenderer.invoke("radius:connect-cloud", input),
  updateStatus: () => ipcRenderer.invoke(DESKTOP_UPDATE_CHANNELS.status),
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
