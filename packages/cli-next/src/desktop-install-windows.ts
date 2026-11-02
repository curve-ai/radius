import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

import { readDesktopPresence } from "./desktop-presence.js";
import {
  compareVersions,
  formatMegabytes,
  type DesktopArtifact,
  type DesktopRelease,
} from "./desktop-release.js";
import { OperationalError } from "./errors.js";

/**
 * Installing, finding and opening the Radius desktop app on Windows.
 *
 * The CLI downloads the release's NSIS installer, checks it against the
 * pinned size and digest, and runs it silently. The installer is per-user, so
 * no administrator prompt appears, and it adds the Start menu shortcut and the
 * Settings → Apps entry a Windows user expects.
 *
 * `/D=` puts the app in %LOCALAPPDATA%\Programs\Radius. Without it the
 * installer names the folder after the npm package, and the runtime lookup in
 * desktop.ts would not find it. A copy someone installed by hand lands in
 * that other folder, so it is found through its uninstall entry instead.
 */

export type WindowsInstallOutcome =
  | {
      readonly status: "installed" | "updated";
      readonly path: string;
      readonly version: string;
      readonly previousVersion: string | null;
    }
  | {
      /** Already at or past the pin; nothing was downloaded. */
      readonly status: "current";
      readonly path: string;
      readonly version: string;
      readonly previousVersion: string;
    };

export function windowsAppExecutable(folder: string): string {
  return join(folder, "radius.exe");
}

/**
 * RADIUS_APP_PATH when set, otherwise the per-user install folder. Always
 * absolute: NSIS rejects a relative `/D=`.
 */
export function windowsInstallPath(env: NodeJS.ProcessEnv): string {
  const explicit = env.RADIUS_APP_PATH?.trim();
  if (explicit) return resolve(explicit);
  const localAppData =
    env.LOCALAPPDATA?.trim() || join(homedir(), "AppData", "Local");
  return join(localAppData, "Programs", "Radius");
}

/**
 * Where an install goes: over the copy already found, so every later lookup
 * finds the updated one, otherwise the default folder.
 */
export function windowsInstallPathFor(
  found: { readonly path: string; readonly installed: boolean } | null,
  env: NodeJS.ProcessEnv,
): string {
  return found?.installed ? found.path : windowsInstallPath(env);
}

/**
 * The install folder, without reading its version: RADIUS_APP_PATH when set,
 * else the default folder, else any folder an uninstall entry names.
 */
export async function findWindowsInstallFolder(
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const preferred = windowsInstallPath(env);
  if (await exists(windowsAppExecutable(preferred))) return preferred;
  if (env.RADIUS_APP_PATH?.trim()) return null;
  for (const entry of await readUninstallEntries()) {
    if (await exists(windowsAppExecutable(entry.folder))) return entry.folder;
  }
  return null;
}

/**
 * The installed version, e.g. "0.2.0-beta.1".
 *
 * Read from the folder's uninstall entry, which carries the full version.
 * radius.exe's FileVersion drops a pre-release tag, so an installed beta
 * would compare as the release and never be updated; it is only the fallback
 * for a copy with no entry.
 */
export async function readWindowsAppVersion(
  folder: string,
): Promise<string | null> {
  const wanted = normaliseFolder(folder);
  const entry = (await readUninstallEntries()).find(
    (candidate) => normaliseFolder(candidate.folder) === wanted,
  );
  return entry?.version ?? (await readFileVersion(folder));
}

interface UninstallEntry {
  readonly folder: string;
  readonly version: string | null;
}

/** The installer registers its uninstaller as `"<folder>\Uninstall radius.exe" /currentuser`. */
export function folderFromUninstallString(value: string): string | null {
  const match = /^"([^"]+\\Uninstall [^"\\]+\.exe)"/i.exec(value.trim());
  return match ? dirname(match[1]!) : null;
}

function normaliseFolder(folder: string): string {
  return resolve(folder).replace(/\\+$/, "").toLowerCase();
}

/**
 * Read once per run: each read starts PowerShell, which takes up to a
 * second. Cleared after an install, which rewrites the entries.
 */
let uninstallEntries: Promise<UninstallEntry[]> | null = null;

function readUninstallEntries(): Promise<UninstallEntry[]> {
  return (uninstallEntries ??= queryUninstallEntries());
}

/** Per-user and per-machine Radius entries from Settings → Apps. */
async function queryUninstallEntries(): Promise<UninstallEntry[]> {
  const script = [
    "$keys = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
    "$entries = @(Get-ItemProperty $keys -ErrorAction SilentlyContinue |",
    "  Where-Object { $_.DisplayName -eq 'Radius' -and $_.UninstallString } |",
    "  ForEach-Object { @{ uninstall = $_.UninstallString; version = $_.DisplayVersion } })",
    "ConvertTo-Json -Compress -InputObject $entries",
  ].join("\n");
  const output = await powershell(script);
  if (!output) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return [];
  }
  const entries: UninstallEntry[] = [];
  for (const item of Array.isArray(parsed) ? parsed : []) {
    const { uninstall, version } = (item ?? {}) as Record<string, unknown>;
    const folder =
      typeof uninstall === "string"
        ? folderFromUninstallString(uninstall)
        : null;
    if (folder) {
      entries.push({
        folder,
        version: typeof version === "string" && version ? version : null,
      });
    }
  }
  return entries;
}

/** The path goes through an environment variable so no quoting can break it. */
function readFileVersion(folder: string): Promise<string | null> {
  return powershell(
    "(Get-Item -LiteralPath $env:RADIUS_EXE).VersionInfo.FileVersion",
    { RADIUS_EXE: windowsAppExecutable(folder) },
  );
}

function powershell(
  script: string,
  extraEnv: Record<string, string> = {},
): Promise<string | null> {
  return new Promise((settle) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { env: { ...process.env, ...extraEnv }, windowsHide: true },
      (error, stdout) => settle(error ? null : stdout.trim() || null),
    );
  });
}

export async function installWindowsDesktopApp(input: {
  readonly release: DesktopRelease;
  readonly artifact: DesktopArtifact;
  readonly installPath: string;
  readonly userDataPath: string;
  readonly onProgress?: (message: string) => void;
  readonly isAlive?: (pid: number) => boolean;
  /** How often progress is reported, at most. */
  readonly progressIntervalMs?: number;
  /**
   * Abandons the download, e.g. on Ctrl-C. Once the installer runs it is
   * left to finish: stopping NSIS midway could leave a broken app.
   */
  readonly signal?: AbortSignal;
}): Promise<WindowsInstallOutcome> {
  const target = input.installPath;
  const onProgress = input.onProgress ?? (() => {});
  const hadPrevious = await exists(windowsAppExecutable(target));

  const previousVersion = hadPrevious
    ? await readWindowsAppVersion(target)
    : null;
  // Never a downgrade: a newer app may have migrated its storage past what
  // the pinned one can read.
  if (
    previousVersion !== null &&
    compareVersions(previousVersion, input.release.version) >= 0
  ) {
    return {
      status: "current",
      path: target,
      version: previousVersion,
      previousVersion,
    };
  }

  // radius.exe is locked while it runs, so the installer could not replace it.
  const presence = await readDesktopPresence(input.userDataPath, input.isAlive);
  if (presence) {
    throw new OperationalError(
      `Radius ${presence.version} is running (pid ${presence.pid}), so it can't be replaced.`,
      "Quit Radius, then run this again.",
    );
  }

  // Checked before a 250 MB download rather than by a failing installer: a
  // copy installed for all users, e.g. in Program Files, needs an
  // administrator to replace, and the per-user installer cannot.
  if (hadPrevious && !(await canWriteInto(target))) {
    throw new OperationalError(
      `Radius at ${target} can't be replaced by this user, so it was not updated.`,
      "Update it the way it was installed, or uninstall it and run `radius app install` to install it for this user.",
    );
  }

  const setup = join(
    tmpdir(),
    `radius-${input.release.version}-setup-${randomBytes(4).toString("hex")}.exe`,
  );
  try {
    onProgress(
      `Downloading Radius ${input.release.version} (${formatMegabytes(input.artifact.size)})…`,
    );
    await downloadVerified(
      input.artifact,
      setup,
      onProgress,
      input.progressIntervalMs ?? 1_000,
      input.signal,
    );

    // Last moment a Ctrl-C can still leave the installed app untouched.
    if (input.signal?.aborted) throw interrupted();
    onProgress("Installing…");
    try {
      await runInstaller(setup, target);
    } finally {
      uninstallEntries = null;
    }
    if (!(await exists(windowsAppExecutable(target)))) {
      throw new OperationalError(
        `The installer finished but ${windowsAppExecutable(target)} is missing.`,
        `It came from ${input.artifact.url}.`,
      );
    }

    return {
      status: hadPrevious ? "updated" : "installed",
      path: target,
      version: (await readWindowsAppVersion(target)) ?? input.release.version,
      previousVersion,
    };
  } finally {
    await rm(setup, { force: true });
  }
}

/**
 * NSIS reads `/D=` raw to the end of the command line and rejects quotes, so
 * the arguments are passed verbatim. The installer path is quoted by hand
 * because verbatim mode quotes nothing, and %TEMP% can contain spaces.
 */
function runInstaller(setup: string, target: string): Promise<void> {
  return new Promise((settle, reject) => {
    const child = spawn(setup, ["/S", `/D=${target}`], {
      argv0: `"${setup}"`,
      windowsVerbatimArguments: true,
      windowsHide: true,
      stdio: "ignore",
    });
    child.once("error", (error) =>
      reject(
        new OperationalError(
          `Could not run the Radius installer: ${error.message}`,
        ),
      ),
    );
    child.once("exit", (code) =>
      code === 0
        ? settle()
        : reject(
            new OperationalError(
              `The Radius installer failed (exit ${String(code)}).`,
              "Nothing usable was installed. Run it again to retry.",
            ),
          ),
    );
  });
}

/**
 * Starts radius.exe and returns once it has started, not when it exits: the
 * app keeps running. It is single-instance, so a running app receives the
 * link through `second-instance` and the new process exits.
 */
export function spawnWindowsApp(
  command: string,
  args: readonly string[],
): Promise<boolean> {
  return new Promise((settle) => {
    // Started in its own folder: a long-running process holds its working
    // directory open, and the CLI's would be the user's project.
    const child = spawn(command, [...args], {
      cwd: dirname(command),
      stdio: "ignore",
      detached: true,
    });
    child.once("error", () => settle(false));
    child.once("spawn", () => {
      child.unref();
      settle(true);
    });
  });
}

/**
 * Streams to disk while hashing and counting, and checks both before the
 * installer runs. The file is deleted on any failure, so an unverified exe is
 * never left where something could run it.
 */
async function downloadVerified(
  artifact: DesktopArtifact,
  destination: string,
  onProgress: (message: string) => void,
  intervalMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(artifact.url, { signal });
  } catch (error) {
    if (signal?.aborted) throw interrupted();
    throw new OperationalError(
      `Could not reach the Radius download: ${(error as Error).message}`,
      `URL: ${artifact.url}`,
    );
  }
  if (!response.ok || !response.body) {
    throw new OperationalError(
      `Downloading Radius failed: ${response.status} ${response.statusText}`,
      `URL: ${artifact.url}`,
    );
  }

  const hash = createHash("sha256");
  let received = 0;
  let reported = Date.now();
  try {
    await pipeline(
      (async function* () {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          received += chunk.byteLength;
          if (received > artifact.size) throw new SizeMismatch();
          hash.update(chunk);
          const now = Date.now();
          if (now - reported >= intervalMs) {
            reported = now;
            onProgress(
              `  ${Math.floor((received / artifact.size) * 100)}%  ${formatMegabytes(received)} of ${formatMegabytes(artifact.size)}`,
            );
          }
          yield chunk;
        }
      })(),
      createWriteStream(destination, { mode: 0o600 }),
      { signal },
    );
  } catch (error) {
    await rm(destination, { force: true });
    if (signal?.aborted) throw interrupted();
    if (error instanceof SizeMismatch) {
      throw mismatch("size", artifact, `more than ${artifact.size} bytes`);
    }
    throw new OperationalError(
      `The Radius download was interrupted: ${(error as Error).message}`,
      "Nothing was installed. Run it again to retry.",
    );
  }

  if (received !== artifact.size) {
    await rm(destination, { force: true });
    throw mismatch("size", artifact, `${received} bytes`);
  }
  const digest = hash.digest("hex");
  if (digest !== artifact.sha256) {
    await rm(destination, { force: true });
    throw mismatch("sha256", artifact, digest);
  }
}

function interrupted(): OperationalError {
  return new OperationalError(
    "The Radius download was stopped.",
    "Nothing was installed.",
  );
}

class SizeMismatch extends Error {}

function mismatch(
  what: "size" | "sha256",
  artifact: DesktopArtifact,
  got: string,
): OperationalError {
  const expected = what === "size" ? `${artifact.size} bytes` : artifact.sha256;
  return new OperationalError(
    `The Radius download does not match its pinned ${what === "size" ? "size" : "checksum"}, so it was deleted and nothing was installed.`,
    `Expected ${expected}, got ${got} (${artifact.url})`,
  );
}

/**
 * Creates and removes a file in `folder`. `access(W_OK)` can't answer this on
 * Windows: it reads only the read-only attribute, not the folder's ACL.
 */
async function canWriteInto(folder: string): Promise<boolean> {
  const probe = join(folder, `.radius-write-${randomBytes(4).toString("hex")}`);
  try {
    await writeFile(probe, "");
    await rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
