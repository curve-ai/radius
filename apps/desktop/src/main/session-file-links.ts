import {
  getSessionProjectContext,
  listProjects,
} from "@curve-ai/radius-storage";
import { shell } from "electron";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { OpenSessionFileInput } from "../radius-api";
import { localDeviceIdentity } from "./device-identity";
import {
  canonicalizeProjectRoot,
  resolveProjectPath,
} from "./project-root-access";
import { initializeStorage } from "./storage";

export interface ParsedSessionFileHref {
  column: number | null;
  line: number | null;
  path: string;
}

export function parseSessionFileHref(
  href: string,
): ParsedSessionFileHref | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.includes("\0") || trimmed.startsWith("#")) {
    return null;
  }

  let filePath: string;
  try {
    if (trimmed.startsWith("file:")) {
      filePath = fileURLToPath(trimmed);
    } else {
      if (!path.isAbsolute(trimmed) && /^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
        return null;
      }
      filePath = decodeURIComponent(trimmed.split("#", 1)[0] ?? "");
    }
  } catch {
    return null;
  }

  const position = filePath.match(/^(.*?):(\d+)(?::(\d+))?$/);
  const line = position?.[2] ? Number(position[2]) : null;
  const column = position?.[3] ? Number(position[3]) : null;
  if (position?.[1]) filePath = position[1];
  if (!filePath || line === 0 || column === 0) return null;
  return { column, line, path: filePath };
}

function parseOpenSessionFileInput(
  input: unknown,
): OpenSessionFileInput | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (
    typeof value.sessionId !== "string" ||
    !value.sessionId ||
    typeof value.href !== "string" ||
    !value.href
  ) {
    return null;
  }
  return { href: value.href, sessionId: value.sessionId };
}

export async function openSessionFile(input: unknown): Promise<void> {
  const request = parseOpenSessionFileInput(input);
  const target = request ? parseSessionFileHref(request.href) : null;
  if (!request || !target) throw new Error("Invalid session file link");

  const context = await initializeStorage();
  const session = await getSessionProjectContext(
    context.database,
    request.sessionId,
  );
  if (!session?.projectId) {
    throw new Error("This chat does not have a project source folder");
  }
  const identity = localDeviceIdentity(context.vault);
  const project = (
    await listProjects(context.database, identity.clientInstanceId)
  ).find((candidate) => candidate.id === session.projectId);
  if (!project || project.roots.length === 0) {
    throw new Error("This project does not have a source folder");
  }

  for (const root of project.roots) {
    try {
      const canonicalRoot = await canonicalizeProjectRoot(root.rootPath);
      const relativePath = path.isAbsolute(target.path)
        ? path.relative(canonicalRoot, target.path)
        : target.path;
      const resolvedPath = await resolveProjectPath(
        canonicalRoot,
        relativePath,
      );
      if (!(await stat(resolvedPath)).isFile()) continue;
      const error = await shell.openPath(resolvedPath);
      if (error) throw new Error(error);
      return;
    } catch {
      continue;
    }
  }
  throw new Error("The linked file is outside this session's project roots");
}
