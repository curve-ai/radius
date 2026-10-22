import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import type { AgentConfig } from "@curve-ai/agent-contracts";

import { OperationalError, UsageError } from "./errors.js";
import { hostPlatformKey } from "./registry.js";

/** A harness is a developer tool, not a disk image; anything larger is a bug or an attack. */
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

function formatBytes(value: number): string {
  return `${(value / (1024 * 1024)).toFixed(0)}MB`;
}

/** Content-addressed, so two agents pinning the same build share one copy. */
export function harnessCacheRoot(): string {
  return join(homedir(), ".radius", "harnesses");
}

export interface ResolvedHarness {
  readonly command: readonly string[];
  readonly source: string;
  readonly cached: boolean;
}

export async function resolveHarness(
  config: AgentConfig,
  root: string,
  host: { platform: string; arch: string },
  onProgress: (message: string) => void,
): Promise<ResolvedHarness> {
  if (config.runtime.kind !== "harness") {
    throw new UsageError(
      `radius dev currently supports runtime.kind "harness"; this config declares "${config.runtime.kind}".`,
    );
  }
  const distribution = config.runtime.distribution;

  if (distribution.kind === "npx" || distribution.kind === "uvx") {
    const runner = distribution.kind === "npx" ? "npx" : "uvx";
    const args =
      runner === "npx"
        ? ["-y", distribution.package, ...distribution.args]
        : [distribution.package, ...distribution.args];
    return {
      command: [runner, ...args],
      source: `${runner} ${distribution.package}`,
      cached: false,
    };
  }

  const platform = hostPlatformKey(host.platform, host.arch);
  const artifact = distribution.platforms[platform];
  if (!artifact) {
    const known = Object.keys(distribution.platforms).sort().join(", ");
    throw new OperationalError(
      `This harness publishes no build for ${platform}.`,
      `It ships: ${known}.`,
    );
  }

  // A platform may override the distribution's command; opencode ships
  // `./opencode.exe` on Windows and `./opencode` everywhere else.
  const launch = {
    cmd: artifact.cmd ?? distribution.cmd,
    args: artifact.args ?? distribution.args,
  };

  // An in-repo archive is taken as-is; a URL must carry a digest, because a
  // remote artifact can change underneath a pinned version.
  if (!/^https?:\/\//.test(artifact.archive)) {
    const localPath = isAbsolute(artifact.archive)
      ? artifact.archive
      : resolve(root, artifact.archive);
    const directory = await extractLocal(localPath, artifact.sha256, onProgress);
    return {
      command: [join(directory, launch.cmd), ...launch.args],
      source: localPath,
      cached: false,
    };
  }
  if (!artifact.sha256) {
    throw new UsageError(
      `The ${platform} archive is a URL but carries no sha256. Radius will not install an unverified harness.`,
    );
  }

  const directory = join(harnessCacheRoot(), artifact.sha256);
  const marker = join(directory, ".complete");
  const alreadyThere = await exists(marker);
  if (!alreadyThere) {
    onProgress(`Downloading ${distribution.cmd} for ${platform}…`);
    await download(artifact.archive, artifact.sha256, directory, onProgress);
  }
  return {
    command: [join(directory, launch.cmd), ...launch.args],
    source: artifact.archive,
    cached: alreadyThere,
  };
}

async function download(
  url: string,
  expected: string,
  directory: string,
  onProgress: (message: string) => void,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new OperationalError(
      `Downloading the harness failed: ${response.status} ${response.statusText}`,
      `URL: ${url}`,
    );
  }

  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_ARCHIVE_BYTES) {
    throw new OperationalError(
      `The harness archive declares ${formatBytes(declared)}, over the ${formatBytes(MAX_ARCHIVE_BYTES)} limit.`,
      `URL: ${url}`,
    );
  }

  const staging = await freshStagingDirectory(`remote-${expected.slice(0, 12)}`);
  const archivePath = join(staging, "archive");
  // Streamed rather than buffered: a 144MB harness should not sit in memory
  // twice, and the cap has to be enforced against bytes actually received,
  // not against a Content-Length the server is free to lie about.
  const actual = await streamToFile(response, archivePath, url);

  if (actual !== expected) {
    await rm(staging, { recursive: true, force: true });
    throw new OperationalError(
      `Checksum mismatch for the harness archive.\n  expected ${expected}\n  actual   ${actual}`,
      "Radius refuses to run an archive that does not match its pinned digest. Re-run `radius init` to pick up a newer registry entry.",
    );
  }
  onProgress(`Verified sha256 ${expected.slice(0, 12)}…`);

  await extractInto(archivePath, staging, url);
  await rm(archivePath, { force: true });
  await writeFile(join(staging, ".complete"), `${expected}\n`, "utf8");

  await mkdir(harnessCacheRoot(), { recursive: true });
  await rm(directory, { recursive: true, force: true });
  await rename(staging, directory);
}

async function streamToFile(
  response: Response,
  destination: string,
  label: string,
): Promise<string> {
  if (!response.body) {
    throw new OperationalError(`The harness download returned no body (${label}).`);
  }
  const hash = createHash("sha256");
  const handle = await open(destination, "w");
  let received = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.byteLength;
      if (received > MAX_ARCHIVE_BYTES) {
        throw new OperationalError(
          `The harness archive exceeded the ${formatBytes(MAX_ARCHIVE_BYTES)} limit while downloading.`,
          `URL: ${label}`,
        );
      }
      hash.update(chunk);
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function digestOf(path: string): Promise<string> {
  const hash = createHash("sha256");
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function freshStagingDirectory(tag: string): Promise<string> {
  const staging = join(tmpdir(), `radius-harness-${tag}`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  return staging;
}

/**
 * Extracts a local archive. When config pins a digest for an in-repo archive
 * it is verified, rather than recorded and ignored: a path is still untrusted
 * input, and a pinned digest that is never checked is worse than none, because
 * it reads as a guarantee.
 */
async function extractLocal(
  archivePath: string,
  expected: string | undefined,
  onProgress: (message: string) => void,
): Promise<string> {
  if (expected) {
    const actual = await digestOf(archivePath);
    if (actual !== expected) {
      throw new OperationalError(
        `Checksum mismatch for ${archivePath}.\n  expected ${expected}\n  actual   ${actual}`,
      );
    }
    onProgress(`Verified sha256 ${expected.slice(0, 12)}…`);
  }
  const staging = await freshStagingDirectory(
    `local-${createHash("sha256").update(archivePath).digest("hex").slice(0, 12)}`,
  );
  onProgress(`Extracting ${archivePath}…`);
  await extractInto(archivePath, staging, archivePath);
  return staging;
}

/**
 * Archive format is decided by the path component only. Reading the whole
 * string meant `…/agent.zip?v=2` was extracted as a tarball.
 */
function isZipArchive(label: string): boolean {
  const path = label.split(/[?#]/, 1)[0] ?? label;
  return /\.zip$/i.test(path);
}

/**
 * Rejects any entry that could write outside the destination BEFORE extracting.
 *
 * The pinned digest does not make an archive safe: it proves the bytes are the
 * ones the registry named, not that the registry named something benign. An
 * entry of `../../../../bin/x`, or a symlink pointing out of the tree, escapes
 * the staging directory — which is then renamed into the harness cache.
 */
async function assertEntriesStayInside(
  archivePath: string,
  zip: boolean,
): Promise<void> {
  const [command, args] = zip
    ? ["unzip", ["-Z1", archivePath]]
    : ["tar", ["tzf", archivePath]];
  const listing = await capture(command as string, args as string[]);
  for (const raw of listing.split("\n")) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry.startsWith("/") || /^[A-Za-z]:[\\/]/.test(entry)) {
      throw new OperationalError(
        `The harness archive contains an absolute path (${entry}).`,
        "Radius will not extract an archive that writes outside its own directory.",
      );
    }
    if (entry.split(/[\\/]/).some((segment) => segment === "..")) {
      throw new OperationalError(
        `The harness archive contains a path-traversal entry (${entry}).`,
        "Radius will not extract an archive that writes outside its own directory.",
      );
    }
  }
}

function capture(command: string, args: string[]): Promise<string> {
  return new Promise((settle, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? settle(out)
        : reject(
            new OperationalError(
              `Could not read the harness archive (${command} exited ${String(code)}).`,
            ),
          ),
    );
  });
}

async function extractInto(
  archivePath: string,
  destination: string,
  label: string,
): Promise<void> {
  const zip = isZipArchive(label);
  await assertEntriesStayInside(archivePath, zip);
  const [command, args] = zip
    ? ["unzip", ["-oq", archivePath, "-d", destination]]
    : // --no-same-owner so extraction never attempts a chown, and -P is
      // deliberately absent so tar keeps stripping leading slashes.
      ["tar", ["xzf", archivePath, "--no-same-owner", "-C", destination]];
  await new Promise<void>((settle, reject) => {
    const child = spawn(command as string, args as string[], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? settle()
        : reject(
            new OperationalError(
              `Extracting the harness archive failed (${command} exited ${String(code)}).`,
            ),
          ),
    );
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
