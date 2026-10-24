import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, chmod, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import { OperationalError } from "./errors.js";

/**
 * The runtime the CLI fetches for itself.
 *
 * Verifying a build means booting it in a microVM, which needs a VM host and
 * a Linux kernel. Those used to be taken out of the installed desktop app —
 * but someone can install the CLI from npm and never install the app, and
 * `build` must still be able to prove what it produced. So the CLI owns them,
 * downloaded and checksum-verified on first use and cached by digest, exactly
 * as it already does for a third-party harness.
 *
 * Pins live here rather than being fetched, so resolving them needs no
 * network and a given CLI version always wants the same bytes.
 */

/** Only the guest architecture varies; the guest is always Linux. */
const KERNEL = {
  /**
   * Published by kata-containers, and already the pin the repo's own asset
   * script uses — the CLI reads the same values rather than inventing a
   * second source of truth.
   */
  archiveUrl:
    "https://github.com/kata-containers/kata-containers/releases/download/3.28.0/kata-static-3.28.0-arm64.tar.zst",
  archiveSha256:
    "f63d54507d1f18635d94475077e4c2330de4d8e05cedf25f7c38f063b0e66a91",
  /** The one member extracted from a ~570MB archive. */
  member: "opt/kata/share/kata-containers/vmlinux-6.18.15-186",
} as const;

/**
 * The VM host, published per CLI release.
 *
 * `null` until the first release that carries it. Left declared rather than
 * omitted so the shape of the missing piece is visible, and so filling it in
 * is a one-line change against a real digest instead of a design decision
 * someone has to rediscover.
 *
 * Updated by the release workflow that builds it — see
 * `.github/workflows/runtime-host-release.yml`.
 */
const HOST: {
  readonly version: string;
  readonly url: string;
  readonly sha256: string;
} | null = null;

export function runtimeCacheRoot(): string {
  return join(homedir(), ".radius", "runtime");
}

export interface FetchedRuntime {
  readonly runtimeHostPath: string;
  readonly kernelPath: string;
  readonly source: string;
}

/**
 * Resolves the runtime from the CLI's own cache, downloading what is missing.
 *
 * Throws rather than returning null when it cannot: the caller has already
 * exhausted every cheaper source, so a failure here is the thing the
 * developer needs explained.
 */
export async function fetchRuntime(
  onProgress: (message: string) => void,
): Promise<FetchedRuntime> {
  if (HOST === null) {
    throw new OperationalError(
      "This CLI has no published runtime host to download yet.",
      [
        "Until one ships, verifying a build needs the Radius desktop app installed (it carries the runtime), or a repo checkout with `bun run runtime:build`.",
        "`--skip-verify` produces the image without booting it.",
      ].join("\n"),
    );
  }

  const kernelPath = await ensureKernel(onProgress);
  const hostPath = await ensureHost(HOST, onProgress);
  return {
    runtimeHostPath: hostPath,
    kernelPath,
    source: `downloaded runtime ${HOST.version} (${runtimeCacheRoot()})`,
  };
}

async function ensureKernel(
  onProgress: (message: string) => void,
): Promise<string> {
  const directory = join(runtimeCacheRoot(), "kernel", KERNEL.archiveSha256);
  const kernelPath = join(directory, "vmlinux-arm64");
  if (await exists(join(directory, ".complete"))) return kernelPath;

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(join(tmpdir(), "radius-kernel-"));
  try {
    const archive = join(scratch, "kernel.tar.zst");
    onProgress("Downloading the guest kernel (~570MB, once)…");
    await download(KERNEL.archiveUrl, KERNEL.archiveSha256, archive);

    // One member out of a large archive. bsdtar reads zstd without a flag.
    onProgress("Extracting the kernel…");
    await run("tar", ["-xf", archive, "-C", scratch, KERNEL.member]);
    await rename(join(scratch, KERNEL.member), kernelPath);
    await chmod(kernelPath, 0o644);
    // Written last, so an interrupted download never looks complete.
    await createWriteStream(join(directory, ".complete")).close();
    return kernelPath;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function ensureHost(
  host: NonNullable<typeof HOST>,
  onProgress: (message: string) => void,
): Promise<string> {
  const directory = join(runtimeCacheRoot(), "host", host.sha256);
  const hostPath = join(directory, "radius-runtime-host");
  if (await exists(join(directory, ".complete"))) return hostPath;

  await mkdir(directory, { recursive: true, mode: 0o700 });
  onProgress(`Downloading the Radius runtime host ${host.version}…`);
  await download(host.url, host.sha256, hostPath);
  await chmod(hostPath, 0o755);
  await createWriteStream(join(directory, ".complete")).close();
  return hostPath;
}

/** Streams to disk while hashing, so nothing oversized is held in memory. */
async function download(
  url: string,
  expected: string,
  destination: string,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new OperationalError(
      `Downloading the runtime failed: ${response.status} ${response.statusText}`,
      `URL: ${url}`,
    );
  }
  const hash = createHash("sha256");
  const partial = `${destination}.partial`;
  await pipeline(
    (async function* () {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk);
        yield chunk;
      }
    })(),
    createWriteStream(partial),
  );
  const digest = hash.digest("hex");
  if (digest !== expected) {
    await rm(partial, { force: true });
    throw new OperationalError(
      "The downloaded runtime does not match its pinned checksum, so it was discarded.",
      `Expected ${expected}, got ${digest} (${url})`,
    );
  }
  await rename(partial, destination);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((settle, reject) => {
    const child = spawn(command, [...args], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-8_192);
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? settle()
        : reject(
            new OperationalError(
              `${command} failed while preparing the runtime (exit ${code}).`,
              stderr.trim() || undefined,
            ),
          ),
    );
  });
}

/** Exported for the error message that lists where the CLI looked. */
export const RUNTIME_HOST_IS_PUBLISHED = HOST !== null;
