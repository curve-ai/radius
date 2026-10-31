import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { z } from "zod";

/**
 * Reading the file a running Radius app writes about itself.
 *
 * The app writes `<userData>/development/desktop.json` on startup and removes
 * it on quit. It is the only way `dev` learns two things it cannot work out
 * alone: whether the app is up, and which folder it watches for agents — a
 * distribution build may move userData, so the CLI must not compute that path.
 */
const PresenceSchema = z.object({
  pid: z.number().int().positive(),
  version: z.string().min(1),
  packaged: z.boolean().optional(),
  agentNoteVersions: z.array(z.number().int().min(1)),
  agentsPath: z.string().min(1).refine(isAbsolute),
});

export type DesktopPresence = z.infer<typeof PresenceSchema>;

export function desktopPresencePath(userDataPath: string): string {
  return join(userDataPath, "development", "desktop.json");
}

/**
 * The live presence, or null.
 *
 * A crash skips the app's cleanup, so the file can name a process that is
 * gone; that counts as no app. Unreadable or malformed counts the same way:
 * the caller's fallback, launching the app, is right in every one of those
 * cases.
 */
export async function readDesktopPresence(
  userDataPath: string,
  isAlive: (pid: number) => boolean = processIsAlive,
): Promise<DesktopPresence | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(desktopPresencePath(userDataPath), "utf8"));
  } catch {
    return null;
  }
  const parsed = PresenceSchema.safeParse(raw);
  if (!parsed.success) return null;
  return isAlive(parsed.data.pid) ? parsed.data : null;
}

/**
 * Polls until a live presence appears, or gives up with null.
 *
 * Polling rather than a file watcher: the directory may not exist until the
 * app creates it, which `fs.watch` cannot wait for, and a cold start takes
 * seconds, so a quarter-second poll costs nothing anyone would notice.
 */
export async function waitForDesktopPresence(
  userDataPath: string,
  timeoutMs: number,
  options: {
    readonly intervalMs?: number;
    readonly isAlive?: (pid: number) => boolean;
  } = {},
): Promise<DesktopPresence | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const presence = await readDesktopPresence(userDataPath, options.isAlive);
    if (presence || Date.now() >= deadline) return presence;
    await new Promise((settle) =>
      setTimeout(
        settle,
        Math.min(options.intervalMs ?? 250, deadline - Date.now()),
      ),
    );
  }
}

/**
 * The same rule the desktop applies to descriptors: signal 0 checks without
 * signalling, and EPERM means the process exists but belongs to someone else.
 */
export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
