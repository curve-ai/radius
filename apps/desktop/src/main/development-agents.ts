import {
  parseDevelopmentAgentConnection,
  type DevelopmentAgentConnection,
} from "@curve-ai/radius-runtime";
import { app } from "electron";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

let developmentAgentWatcher: FSWatcher | null = null;

function developmentAgentsPath(): string {
  return path.join(app.getPath("userData"), "development", "agents");
}

export async function listDevelopmentAgentConnections(): Promise<
  DevelopmentAgentConnection[]
> {
  const directory = developmentAgentsPath();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const entries = await readdir(directory, { withFileTypes: true });
  const connections: DevelopmentAgentConnection[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const connection = parseDevelopmentAgentConnection(
        JSON.parse(await readFile(path.join(directory, entry.name), "utf8")),
      );
      if (processIsAlive(connection.ownerPid)) connections.push(connection);
    } catch (error) {
      console.error(
        `[agents] Ignoring invalid development registration ${entry.name}`,
        error,
      );
    }
  }
  return connections.sort((left, right) =>
    left.registeredAt.localeCompare(right.registeredAt),
  );
}

export async function initializeDevelopmentAgentConnections(
  onChange: () => void,
): Promise<void> {
  const directory = developmentAgentsPath();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  developmentAgentWatcher?.close();
  developmentAgentWatcher = watch(directory, { persistent: false }, onChange);
}

export function stopDevelopmentAgentConnections(): void {
  developmentAgentWatcher?.close();
  developmentAgentWatcher = null;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
