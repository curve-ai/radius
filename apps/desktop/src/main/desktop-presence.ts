import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * What `radius dev` reads to learn that the app is running and where it
 * should register agents. The CLI cannot derive the agents folder itself once
 * a distribution build moves userData, so the app states it.
 */
export interface DesktopPresence {
  pid: number;
  version: string;
  packaged: boolean;
  agentNoteVersions: readonly number[];
  agentsPath: string;
}

export function desktopPresencePath(userDataPath: string): string {
  return path.join(userDataPath, "development", "desktop.json");
}

export async function writeDesktopPresence(
  userDataPath: string,
  presence: DesktopPresence,
): Promise<void> {
  const target = desktopPresencePath(userDataPath);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  // Rename is atomic, so the CLI never reads a half-written file.
  const temporary = `${target}.tmp-${presence.pid}`;
  await writeFile(temporary, `${JSON.stringify(presence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, target);
}

/**
 * Removes the file only while it still names this process, so a quitting app
 * cannot delete the presence of an instance that started after it.
 */
export async function removeDesktopPresence(
  userDataPath: string,
  pid: number,
): Promise<void> {
  const target = desktopPresencePath(userDataPath);
  try {
    const current = JSON.parse(await readFile(target, "utf8")) as {
      pid?: unknown;
    };
    if (current.pid !== pid) return;
  } catch {
    // Missing or unreadable: there is nothing of ours to remove.
    return;
  }
  await rm(target, { force: true });
}
