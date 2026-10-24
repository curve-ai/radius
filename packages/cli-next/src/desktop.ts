import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { OperationalError } from "./errors.js";

/**
 * Finding and launching the installed Radius desktop app.
 *
 * Both halves of this file exist because the CLI used to assume a repo
 * checkout. A developer installs the app; they do not clone the product to
 * use it. The packaged app already carries the runtime host and the guest
 * kernel under `Contents/Resources/runtime/`, so the only thing missing was
 * the CLI looking there.
 */

export interface RuntimeAssets {
  readonly runtimeHostPath: string;
  readonly kernelPath: string;
  /** Where these came from, so the CLI can say so rather than being opaque. */
  readonly source: string;
}

/** Walk-up roots, so a project inside the repo finds the repo. */
function repoCandidates(projectRoot: string): string[] {
  return [projectRoot, join(projectRoot, ".."), join(projectRoot, "..", "..")];
}

function appBundleCandidates(
  env: NodeJS.ProcessEnv,
  projectRoot?: string,
): string[] {
  const explicit = env.RADIUS_APP_PATH?.trim();
  return [
    ...(explicit ? [explicit] : []),
    "/Applications/Radius.app",
    join(homedir(), "Applications", "Radius.app"),
    // Someone working on Radius who has run `package` has a real bundle in
    // the checkout, and would expect `dev` to open that one rather than be
    // told nothing is installed.
    ...(projectRoot
      ? repoCandidates(projectRoot).flatMap((root) => [
          join(root, "apps", "desktop", "dist", "mac-arm64", "Radius.app"),
          join(root, "apps", "desktop", "dist", "mac", "Radius.app"),
        ])
      : []),
  ];
}

/** The repo root, if this project sits inside a Radius checkout. */
async function findRepoRoot(projectRoot: string): Promise<string | null> {
  for (const root of repoCandidates(projectRoot)) {
    try {
      await access(join(root, "apps", "desktop", "package.json"));
      return root;
    } catch {
      // Not a checkout; try the next level up.
    }
  }
  return null;
}

/**
 * In order of how much the caller meant it: an explicit override, then the
 * installed app, then a repo checkout for people working on Radius itself.
 */
export async function resolveRuntimeAssets(input: {
  readonly projectRoot: string;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: string;
}): Promise<RuntimeAssets> {
  const overriddenHost = input.env.RADIUS_RUNTIME_HOST_PATH?.trim();
  const overriddenKernel = input.env.RADIUS_KERNEL_PATH?.trim();
  if (overriddenHost && overriddenKernel) {
    return {
      runtimeHostPath: overriddenHost,
      kernelPath: overriddenKernel,
      source: "RADIUS_RUNTIME_HOST_PATH / RADIUS_KERNEL_PATH",
    };
  }

  const tried: string[] = [];

  for (const bundle of appBundleCandidates(input.env, input.projectRoot)) {
    const runtime = join(bundle, "Contents", "Resources", "runtime");
    const host = join(runtime, `macos-${process.arch}`, "radius-runtime-host");
    const kernel = join(runtime, "vmlinux-arm64");
    tried.push(bundle);
    if (await bothExist(host, kernel)) {
      return {
        runtimeHostPath: overriddenHost ?? host,
        kernelPath: overriddenKernel ?? kernel,
        source: bundle,
      };
    }
  }

  // Working on Radius itself: the assets sit in the checkout, not an app.
  for (const candidate of [
    input.projectRoot,
    join(input.projectRoot, ".."),
    join(input.projectRoot, "..", ".."),
  ]) {
    const base = join(candidate, "apps", "runtime-host-macos", ".build");
    const host = join(base, "release", "radius-runtime-host");
    tried.push(base);
    for (const kernel of [
      join(base, "runtime-assets", "vmlinux-arm64"),
      join(base, "vmlinux-arm64"),
    ]) {
      if (await bothExist(host, kernel)) {
        return {
          runtimeHostPath: overriddenHost ?? host,
          kernelPath: overriddenKernel ?? kernel,
          source: `${base} (repo checkout)`,
        };
      }
    }
  }

  throw new OperationalError(
    "Could not find the Radius runtime, which is what boots the microVM a build is verified in.",
    [
      "Install the Radius desktop app — it ships the runtime — or pass --skip-verify to stop at the image.",
      "",
      "Looked in:",
      ...tried.map((path) => `  ${path}`),
      "",
      "Override with RADIUS_APP_PATH, or RADIUS_RUNTIME_HOST_PATH and RADIUS_KERNEL_PATH together.",
    ].join("\n"),
  );
}

async function bothExist(host: string, kernel: string): Promise<boolean> {
  try {
    await Promise.all([access(host, constants.X_OK), access(kernel)]);
    return true;
  } catch {
    return false;
  }
}

export interface LaunchResult {
  readonly launched: boolean;
  readonly detail: string;
}

/**
 * Brings the desktop app up so the developer does not have to.
 *
 * `dev` registers the agent by writing a descriptor the app watches, which
 * works whether the app starts before or after — so launching it is a
 * convenience, never a requirement. Failure is reported and ignored: a dev
 * session that already works must not die because an app could not be opened.
 */
export async function launchDesktopApp(input: {
  readonly platform: string;
  readonly env: NodeJS.ProcessEnv;
  readonly projectRoot: string;
}): Promise<LaunchResult> {
  if (input.platform !== "darwin") {
    return {
      launched: false,
      detail: "Opening Radius automatically is macOS-only for now.",
    };
  }

  for (const bundle of appBundleCandidates(input.env, input.projectRoot)) {
    try {
      await access(bundle);
    } catch {
      continue;
    }
    const opened = await open(bundle);
    return opened
      ? { launched: true, detail: bundle }
      : {
          launched: false,
          detail: `Found ${bundle} but could not open it. Open Radius yourself.`,
        };
  }

  // No bundle. If this is a Radius checkout the app exists as source, and the
  // useful answer is the command that starts it — not "not installed", which
  // is false and unactionable for the one person most likely to see it.
  // Deliberately not run for them: `electron-vite dev` is a long-lived build
  // process that would outlive this command or have to be supervised by it.
  const repo = await findRepoRoot(input.projectRoot);
  if (repo) {
    return {
      launched: false,
      detail: [
        "Radius is not installed as an app.",
        `Running from source: \`bun run dev\` in ${repo}.`,
        "For a bundle this command can open: `bun run --cwd apps/desktop package`.",
      ].join(" "),
    };
  }
  return {
    launched: false,
    detail:
      "Radius does not appear to be installed. The agent is registered — open Radius and it will show up.",
  };
}

/**
 * `-g` keeps the app in the background: a developer running `dev` is looking
 * at a terminal, and stealing focus mid-command is rude. `-j` leaves an
 * already-running app alone rather than raising it.
 */
function open(bundle: string): Promise<boolean> {
  return new Promise((settle) => {
    const child = spawn("open", ["-g", "-j", bundle], {
      stdio: "ignore",
      detached: true,
    });
    child.once("error", () => settle(false));
    child.once("exit", (code) => settle(code === 0));
    child.unref();
  });
}
