import {
  createProject,
  listAllProjectSessions,
  listProjects,
  listRecentSessions,
  setSessionPinned,
  setProjectRoot,
  updateProjectName,
} from "@curve-ai/radius-storage";
import {
  BrowserWindow,
  dialog,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { localDeviceIdentity } from "./device-identity";
import { canonicalizeProjectRoot } from "./project-root-access";
import { initializeStorage } from "./storage";
import type {
  ProjectFolderSelection,
  ProjectSidebarRecord,
  RecentSidebarSession,
} from "../radius-api";

const PROJECT_FOLDER_SELECTION_TTL_MS = 10 * 60 * 1_000;
const projectFolderSelections = new Map<
  string,
  { rootPath: string; expiresAtMs: number; claimed: boolean }
>();

function pruneExpiredProjectFolderSelections(now = Date.now()): void {
  for (const [selectionId, selection] of projectFolderSelections) {
    if (selection.expiresAtMs <= now)
      projectFolderSelections.delete(selectionId);
  }
}

function parseProjectName(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("A project name is required");
  }
  const name = value.trim();
  if (!name) throw new Error("A project name is required");
  if (name.length > 120) {
    throw new Error("Project name must be 120 characters or fewer");
  }
  return name;
}

export async function listProjectSidebar(): Promise<ProjectSidebarRecord[]> {
  const context = await initializeStorage();
  const identity = localDeviceIdentity(context.vault);
  const [projectRecords, sessionRecords] = await Promise.all([
    listProjects(context.database, identity.clientInstanceId),
    listAllProjectSessions(context.database, identity.clientInstanceId),
  ]);
  const sessionsByProject = new Map<string, ProjectSidebarRecord["sessions"]>();
  for (const session of sessionRecords) {
    const projectSessions = sessionsByProject.get(session.projectId) ?? [];
    projectSessions.push({
      id: session.id,
      title: session.title,
      status: session.status,
      updatedAt: session.updatedAt,
      pinnedAt: session.pinnedAt,
    });
    sessionsByProject.set(session.projectId, projectSessions);
  }

  return projectRecords.map((project) => ({
    id: project.id,
    name: project.name,
    rootPath: project.rootPath,
    sessions: sessionsByProject.get(project.id) ?? [],
  }));
}

export async function listRecentSidebar(): Promise<RecentSidebarSession[]> {
  const context = await initializeStorage();
  const identity = localDeviceIdentity(context.vault);
  return (
    await listRecentSessions(context.database, identity.clientInstanceId)
  ).map((session) => ({
    id: session.id,
    title: session.title,
    status: session.status,
    updatedAt: session.updatedAt,
    pinnedAt: session.pinnedAt,
  }));
}

async function chooseRootFolder(
  event: IpcMainInvokeEvent,
): Promise<string | null> {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const result = parent
    ? await dialog.showOpenDialog(parent, {
        title: "Choose a project folder",
        buttonLabel: "Choose folder",
        properties: ["openDirectory", "createDirectory"],
      })
    : await dialog.showOpenDialog({
        title: "Choose a project folder",
        buttonLabel: "Choose folder",
        properties: ["openDirectory", "createDirectory"],
      });
  if (result.canceled || !result.filePaths[0]) return null;
  return canonicalizeProjectRoot(result.filePaths[0]);
}

export async function chooseProjectFolderForRenderer(
  event: IpcMainInvokeEvent,
): Promise<ProjectFolderSelection | null> {
  const rootPath = await chooseRootFolder(event);
  if (!rootPath) return null;

  const selectionId = randomUUID();
  const now = Date.now();
  pruneExpiredProjectFolderSelections(now);
  projectFolderSelections.set(selectionId, {
    rootPath,
    expiresAtMs: now + PROJECT_FOLDER_SELECTION_TTL_MS,
    claimed: false,
  });
  return { selectionId, rootPath, defaultName: path.basename(rootPath) };
}

export async function createProjectFromSelection(
  _event: IpcMainInvokeEvent,
  input: unknown,
): Promise<ProjectSidebarRecord> {
  if (!input || typeof input !== "object") {
    throw new Error("Project details are required");
  }
  const selectionId = Reflect.get(input, "selectionId");
  if (typeof selectionId !== "string" || !selectionId) {
    throw new Error("A project-folder selection is required");
  }
  const name = parseProjectName(Reflect.get(input, "name"));

  pruneExpiredProjectFolderSelections();
  const selection = projectFolderSelections.get(selectionId);
  if (!selection) {
    throw new Error(
      "Project folder selection expired; choose the folder again",
    );
  }
  if (selection.claimed) {
    throw new Error("Project creation is already in progress");
  }
  selection.claimed = true;

  try {
    const context = await initializeStorage();
    const identity = localDeviceIdentity(context.vault);
    const project = await createProject(context.database, {
      originClientInstanceId: identity.clientInstanceId,
      name,
      rootPath: selection.rootPath,
    });
    projectFolderSelections.delete(selectionId);
    return {
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
      sessions: [],
    };
  } catch (error) {
    selection.claimed = false;
    throw error;
  }
}

export function discardProjectFolderSelection(
  _event: IpcMainInvokeEvent,
  selectionId: unknown,
): void {
  if (typeof selectionId === "string") {
    projectFolderSelections.delete(selectionId);
  }
}

export async function relinkProjectFolder(
  event: IpcMainInvokeEvent,
  projectId: unknown,
): Promise<boolean> {
  if (typeof projectId !== "string" || !projectId) {
    throw new Error("A project identifier is required");
  }
  const rootPath = await chooseRootFolder(event);
  if (!rootPath) return false;

  const context = await initializeStorage();
  const identity = localDeviceIdentity(context.vault);
  await setProjectRoot(context.database, {
    projectId,
    clientInstanceId: identity.clientInstanceId,
    rootPath,
  });
  return true;
}

export async function renameProjectFromRenderer(
  _event: IpcMainInvokeEvent,
  input: unknown,
): Promise<void> {
  if (!input || typeof input !== "object") {
    throw new Error("Project details are required");
  }
  const projectId = Reflect.get(input, "projectId");
  if (typeof projectId !== "string" || !projectId) {
    throw new Error("A project identifier is required");
  }
  const name = parseProjectName(Reflect.get(input, "name"));

  const context = await initializeStorage();
  const identity = localDeviceIdentity(context.vault);
  await updateProjectName(context.database, {
    projectId,
    originClientInstanceId: identity.clientInstanceId,
    name,
  });
}

export async function revealProjectInFinder(
  _event: IpcMainInvokeEvent,
  projectId: unknown,
): Promise<void> {
  if (typeof projectId !== "string" || !projectId) {
    throw new Error("A project identifier is required");
  }

  const context = await initializeStorage();
  const identity = localDeviceIdentity(context.vault);
  const project = (
    await listProjects(context.database, identity.clientInstanceId)
  ).find((candidate) => candidate.id === projectId);
  if (!project?.rootPath) {
    throw new Error("Link this project to a local folder first");
  }
  shell.showItemInFolder(project.rootPath);
}

export async function setSessionPinnedFromRenderer(
  _event: IpcMainInvokeEvent,
  sessionId: unknown,
  pinned: unknown,
): Promise<void> {
  if (typeof sessionId !== "string" || !sessionId) {
    throw new Error("A session identifier is required");
  }
  if (typeof pinned !== "boolean") {
    throw new Error("Pinned state must be a boolean");
  }

  const context = await initializeStorage();
  const identity = localDeviceIdentity(context.vault);
  await setSessionPinned(context.database, {
    clientInstanceId: identity.clientInstanceId,
    sessionId,
    pinned,
  });
}
