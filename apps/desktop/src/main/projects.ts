import {
  addProjectRoot,
  createProject,
  listAllProjectSessions,
  listProjects,
  listRecentSessions,
  listSessionTranscript,
  removeProjectRoot,
  setSessionArchived,
  setSessionPinned,
  updateProjectName,
  updateSessionTitle,
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
import {
  getStreamingSessionMessage,
  isAgentSessionWorking,
  overlayPendingHostApprovalDetails,
} from "./agent-runtime";
import type {
  ProjectFolderSelection,
  ProjectSidebarRecord,
  RecentSidebarSession,
  SessionTranscriptEvent,
} from "../radius-api";

const PROJECT_FOLDER_SELECTION_TTL_MS = 10 * 60 * 1_000;
interface ProjectFolderCapability {
  rootPath: string;
  expiresAtMs: number;
  claimed: boolean;
}
const projectFolderSelections = new Map<string, ProjectFolderCapability>();

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

function parseSessionTitle(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("A session title is required");
  }
  const title = value.trim();
  if (!title) throw new Error("A session title is required");
  if (title.length > 120) {
    throw new Error("Session title must be 120 characters or fewer");
  }
  return title;
}

function parseFolderSelectionIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    value.some((selectionId) => typeof selectionId !== "string" || !selectionId)
  ) {
    throw new Error("The project-folder selections are invalid");
  }
  if (new Set(value).size !== value.length) {
    throw new Error("Project-folder selections must be unique");
  }
  return value;
}

function projectRootSummary(root: {
  id: string;
  rootPath: string;
}): ProjectSidebarRecord["roots"][number] {
  return {
    ...root,
    name: path.basename(root.rootPath),
  };
}

function projectRootSummaries(
  roots: readonly { id: string; rootPath: string }[],
): ProjectSidebarRecord["roots"] {
  return roots.map(projectRootSummary);
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
      lastAssistantMessageAt: session.lastAssistantMessageAt,
      pinnedAt: session.pinnedAt,
      working: isAgentSessionWorking(session.id),
    });
    sessionsByProject.set(session.projectId, projectSessions);
  }

  return projectRecords.map((project) => ({
    id: project.id,
    name: project.name,
    roots: projectRootSummaries(project.roots),
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
    lastAssistantMessageAt: session.lastAssistantMessageAt,
    pinnedAt: session.pinnedAt,
    working: isAgentSessionWorking(session.id),
  }));
}

export async function listSessionTranscriptForRenderer(
  _event: IpcMainInvokeEvent,
  sessionId: unknown,
): Promise<SessionTranscriptEvent[]> {
  if (typeof sessionId !== "string" || !sessionId) {
    throw new Error("A session identifier is required");
  }

  const context = await initializeStorage();
  const transcript = overlayPendingHostApprovalDetails(
    sessionId,
    await listSessionTranscript(context.database, sessionId),
  );
  const streamingMessage = getStreamingSessionMessage(sessionId);
  if (
    !streamingMessage ||
    transcript.some((event) => event.eventId === streamingMessage.eventId)
  ) {
    return transcript;
  }

  return [
    ...transcript,
    {
      ...streamingMessage,
      sessionRevision: (transcript.at(-1)?.sessionRevision ?? 0) + 1,
    },
  ];
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

export async function createProjectFromRenderer(
  _event: IpcMainInvokeEvent,
  input: unknown,
): Promise<ProjectSidebarRecord> {
  if (!input || typeof input !== "object") {
    throw new Error("Project details are required");
  }
  const selectionIds = parseFolderSelectionIds(
    Reflect.get(input, "selectionIds"),
  );
  const name = parseProjectName(Reflect.get(input, "name"));

  pruneExpiredProjectFolderSelections();
  const selections: ProjectFolderCapability[] = [];
  for (const selectionId of selectionIds) {
    const selection = projectFolderSelections.get(selectionId);
    if (!selection) {
      throw new Error(
        "A project folder selection expired; choose the folder again",
      );
    }
    selections.push(selection);
  }
  if (selections.some((selection) => selection.claimed)) {
    throw new Error("Project creation is already in progress");
  }
  const rootPaths = selections.map((selection) => selection.rootPath);
  if (new Set(rootPaths).size !== rootPaths.length) {
    throw new Error("Each project source folder must be unique");
  }
  for (const selection of selections) selection.claimed = true;

  try {
    const context = await initializeStorage();
    const identity = localDeviceIdentity(context.vault);
    const project = await createProject(context.database, {
      originClientInstanceId: identity.clientInstanceId,
      name,
      rootPaths,
    });
    for (const selectionId of selectionIds) {
      projectFolderSelections.delete(selectionId);
    }
    return {
      id: project.id,
      name: project.name,
      roots: projectRootSummaries(project.roots),
      sessions: [],
    };
  } catch (error) {
    for (const selection of selections) selection.claimed = false;
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

export async function addProjectFolderForRenderer(
  event: IpcMainInvokeEvent,
  projectId: unknown,
): Promise<ProjectSidebarRecord["roots"][number] | null> {
  if (typeof projectId !== "string" || !projectId) {
    throw new Error("A project identifier is required");
  }
  const rootPath = await chooseRootFolder(event);
  if (!rootPath) return null;

  const context = await initializeStorage();
  const identity = localDeviceIdentity(context.vault);
  const root = await addProjectRoot(context.database, {
    projectId,
    clientInstanceId: identity.clientInstanceId,
    rootPath,
  });
  return projectRootSummary(root);
}

export async function removeProjectFolderForRenderer(
  _event: IpcMainInvokeEvent,
  input: unknown,
): Promise<void> {
  if (!input || typeof input !== "object") {
    throw new Error("Project folder details are required");
  }
  const projectId = Reflect.get(input, "projectId");
  const rootId = Reflect.get(input, "rootId");
  if (typeof projectId !== "string" || !projectId) {
    throw new Error("A project identifier is required");
  }
  if (typeof rootId !== "string" || !rootId) {
    throw new Error("A project source-folder identifier is required");
  }

  const context = await initializeStorage();
  const identity = localDeviceIdentity(context.vault);
  await removeProjectRoot(context.database, {
    projectId,
    clientInstanceId: identity.clientInstanceId,
    rootId,
  });
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

export async function renameSessionFromRenderer(
  _event: IpcMainInvokeEvent,
  input: unknown,
): Promise<void> {
  if (!input || typeof input !== "object") {
    throw new Error("Session details are required");
  }
  const sessionId = Reflect.get(input, "sessionId");
  if (typeof sessionId !== "string" || !sessionId) {
    throw new Error("A session identifier is required");
  }
  const title = parseSessionTitle(Reflect.get(input, "title"));

  const context = await initializeStorage();
  const identity = localDeviceIdentity(context.vault);
  await updateSessionTitle(context.database, {
    sessionId,
    originClientInstanceId: identity.clientInstanceId,
    title,
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
  if (!project || project.roots.length === 0) {
    throw new Error("Add a source folder to this project first");
  }
  const errors = await Promise.all(
    project.roots.map((root) => shell.openPath(root.rootPath)),
  );
  const error = errors.find(Boolean);
  if (error) throw new Error(error);
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

export async function setSessionArchivedFromRenderer(
  _event: IpcMainInvokeEvent,
  sessionId: unknown,
): Promise<void> {
  if (typeof sessionId !== "string" || !sessionId) {
    throw new Error("A session identifier is required");
  }

  const context = await initializeStorage();
  const identity = localDeviceIdentity(context.vault);
  await setSessionArchived(context.database, {
    originClientInstanceId: identity.clientInstanceId,
    sessionId,
  });
}
