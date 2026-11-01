import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, constants, mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

import { readDesktopPresence } from "./desktop-presence.js";
import {
  compareVersions,
  formatMegabytes,
  type DesktopArtifact,
  type DesktopRelease,
} from "./desktop-release.js";
import { exists, type FoundApp } from "./desktop.js";
import { OperationalError } from "./errors.js";

/**
 * Installing and updating the Radius desktop app on macOS.
 *
 * The CLI does this rather than an installer or the app itself because the
 * build is unsigned: Electron's auto-update refuses unsigned macOS apps, and
 * a browser download would be quarantined and blocked by Gatekeeper. A CLI
 * download carries no quarantine flag, so the CLI is the one channel that can
 * put a working app on the machine and keep it current.
 *
 * Every step happens next to the target, so the final move is a rename on one
 * volume and an interrupted install never leaves a half-written Radius.app.
 */

export function readBundleVersion(bundle: string): Promise<string | null> {
  return new Promise((settle) => {
    execFile(
      "plutil",
      [
        "-extract",
        "CFBundleShortVersionString",
        "raw",
        join(bundle, "Contents", "Info.plist"),
      ],
      (error, stdout) => settle(error ? null : stdout.trim() || null),
    );
  });
}

/**
 * Where an install goes, given what `findDesktopApp` found.
 *
 * An installed copy is updated where it is, because that is the one every
 * later lookup finds first: installing beside it would leave `dev`, `app
 * path` and `app open` on the old bundle while the update reported success.
 * If it can't be replaced, `installDesktopApp` says so instead of putting a
 * second copy somewhere else. With nothing installed, RADIUS_APP_PATH when
 * set, otherwise ~/Applications, which needs no administrator.
 */
export function installPathFor(
  found: FoundApp | null,
  env: NodeJS.ProcessEnv,
): string {
  if (found?.installed) return found.path;
  const explicit = env.RADIUS_APP_PATH?.trim();
  if (explicit) return explicit;
  return join(homedir(), "Applications", "Radius.app");
}

export type InstallOutcome =
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

export async function installDesktopApp(input: {
  readonly release: DesktopRelease;
  readonly artifact: DesktopArtifact;
  readonly installPath: string;
  readonly userDataPath: string;
  readonly onProgress?: (message: string) => void;
  readonly isAlive?: (pid: number) => boolean;
  /** How often progress is reported, at most. */
  readonly progressIntervalMs?: number;
  /** Abandons the download, e.g. on Ctrl-C; nothing is installed. */
  readonly signal?: AbortSignal;
}): Promise<InstallOutcome> {
  const target = input.installPath;
  const onProgress = input.onProgress ?? (() => {});

  const previousVersion = (await exists(target))
    ? await readBundleVersion(target)
    : null;
  // Never a downgrade: a newer app may have migrated its storage past what
  // the pinned one can read, and losing that is worse than running ahead of
  // the CLI.
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

  // Replacing the bundle under a running app breaks it in ways that show up
  // later and look unrelated, so the user quits it first.
  const presence = await readDesktopPresence(input.userDataPath, input.isAlive);
  if (presence) {
    throw new OperationalError(
      `Radius ${presence.version} is running (pid ${presence.pid}), so it can't be replaced.`,
      "Quit Radius, then run this again.",
    );
  }

  const parent = dirname(target);
  // Checked before a 200 MB download rather than at the rename it would
  // fail: replacing a bundle needs write access to it and to its folder,
  // which an /Applications copy installed by an administrator lacks.
  if (
    (await exists(target)) &&
    (!(await writable(parent)) || !(await writable(target)))
  ) {
    throw new OperationalError(
      `Radius at ${target} can't be replaced by this user, so it was not updated.`,
      "Update it the way it was installed, or remove it and run `radius app install` to install into ~/Applications.",
    );
  }
  await mkdir(parent, { recursive: true });
  const suffix = randomBytes(4).toString("hex");
  const name = basename(target);
  const archive = join(parent, `.${name}.download-${suffix}.zip`);
  const staging = join(parent, `.${name}.staging-${suffix}`);
  const aside = join(parent, `.${name}.old-${suffix}`);

  try {
    onProgress(
      `Downloading Radius ${input.release.version} (${formatMegabytes(input.artifact.size)})…`,
    );
    await downloadVerified(
      input.artifact,
      archive,
      onProgress,
      input.progressIntervalMs ?? 1_000,
      input.signal,
    );

    // ditto, not unzip or a JS zip library: it keeps the symlinks and modes
    // inside the frameworks, without which the code signature is broken and
    // the app will not start.
    onProgress("Unpacking…");
    await mkdir(staging);
    await run("ditto", ["-x", "-k", archive, staging]);
    const unpacked = join(staging, "Radius.app");
    if (!(await exists(join(unpacked, "Contents", "MacOS", "Radius")))) {
      throw new OperationalError(
        "The downloaded archive does not contain Radius.app/Contents/MacOS/Radius.",
        `It came from ${input.artifact.url}. Nothing was installed.`,
      );
    }

    // Moved aside rather than removed first, so a failed swap can put the
    // working copy back.
    const hadPrevious = await exists(target);
    if (hadPrevious) await rename(target, aside);
    try {
      await rename(unpacked, target);
    } catch (error) {
      if (hadPrevious) await rename(aside, target);
      throw error;
    }
    if (hadPrevious) await rm(aside, { recursive: true, force: true });

    return {
      status: hadPrevious ? "updated" : "installed",
      path: target,
      version: (await readBundleVersion(target)) ?? input.release.version,
      previousVersion,
    };
  } finally {
    await rm(archive, { force: true });
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * Streams to disk while hashing and counting, and checks both before the
 * caller unpacks anything. The file is deleted on any failure, so an
 * unverified archive never stays where something could pick it up.
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
          // Stopped early rather than at the end: a server sending more than
          // the pinned size is already wrong, and there is no reason to keep
          // writing it.
          if (received > artifact.size) {
            throw new SizeMismatch(received);
          }
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

class SizeMismatch extends Error {
  constructor(readonly received: number) {
    super("size mismatch");
  }
}

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
 * What the user sees on the first launch after an install or update, said
 * before it happens so a password prompt from an unknown app is expected
 * rather than alarming.
 */
export function keychainNotice(): string[] {
  return [
    "The first time Radius opens after an install or update, macOS asks for your login password,",
    "because this build is unsigned and Radius keeps its storage key in the keychain.",
    'Enter it and choose "Always Allow". If you deny it, Radius can\'t open its local storage.',
  ];
}

async function writable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((settle, reject) => {
    execFile(command, [...args], (error, _stdout, stderr) => {
      if (!error) {
        settle();
        return;
      }
      reject(
        new OperationalError(
          `${command} failed while installing Radius: ${error.message}`,
          stderr.trim() || undefined,
        ),
      );
    });
  });
}
