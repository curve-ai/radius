import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

import { z } from "zod";

import { OperationalError } from "./errors.js";
import { hostPlatformKey } from "./registry.js";

/**
 * The desktop release this CLI installs.
 *
 * A mirror of `apps/desktop/scripts/release-manifest.schema.json`, the
 * `radius-desktop.json` attached to every desktop-v* release. Parsed with
 * unknown fields stripped rather than rejected, so a manifest that grows a
 * field later still reads in this CLI; the publisher's schema is the strict
 * one.
 */
const ArtifactSchema = z.object({
  // The publisher pins these to GitHub release downloads. The CLI only needs
  // an https URL: what makes a download safe to unpack is the digest, and the
  // test override has to be able to point at a local server.
  url: z.url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().min(1),
});

const ManifestSchema = z.object({
  version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/),
  agentNoteVersions: z.array(z.number().int().min(1)).min(1),
  platforms: z
    .record(
      z.string().regex(/^(darwin|windows|linux)\/(arm64|amd64)$/),
      ArtifactSchema,
    )
    .refine((platforms) => Object.keys(platforms).length > 0, {
      message: "A release has at least one platform",
    }),
});

export type DesktopArtifact = z.infer<typeof ArtifactSchema>;
export type DesktopRelease = z.infer<typeof ManifestSchema>;

/**
 * desktop-v0.1.0, copied from its radius-desktop.json.
 *
 * A constant, not a lookup: resolving it needs no network, and a given CLI
 * version always installs the same bytes. Moving to a newer app means copying
 * that release's manifest values here.
 */
export const PINNED_DESKTOP_RELEASE: DesktopRelease = {
  version: "0.1.0",
  agentNoteVersions: [1],
  platforms: {
    "darwin/arm64": {
      url: "https://github.com/curve-ai/radius/releases/download/desktop-v0.1.0/radius-0.1.0-mac-arm64.zip",
      sha256:
        "9f06575f7a422b00382a36645670707fb316f353f6150400780115de23222cf8",
      size: 207587843,
    },
    "windows/amd64": {
      url: "https://github.com/curve-ai/radius/releases/download/desktop-v0.1.0/radius-0.1.0-win-x64.zip",
      sha256:
        "c260662553840534c8e9792b7f72a1cba085932ba6bb4a3a9365adc1f9b0d3d0",
      size: 367445459,
    },
    "linux/amd64": {
      url: "https://github.com/curve-ai/radius/releases/download/desktop-v0.1.0/radius-0.1.0-linux-x86_64.AppImage",
      sha256:
        "a9685fd8454106e62b4efa23b7868fdf41d024ae881be20fe3e7fc7309c8b481",
      size: 198867342,
    },
  },
};

export function parseDesktopRelease(input: unknown): DesktopRelease {
  return ManifestSchema.parse(input);
}

/**
 * The pin, unless RADIUS_APP_MANIFEST names another manifest (a path or an
 * https URL).
 *
 * For testing only: it is how an unpublished build, or the download path
 * itself, is exercised before a release exists. It widens where bytes may
 * come from, never whether they are checked, because every artifact still
 * carries a size and digest the download must match.
 */
export async function loadDesktopRelease(
  env: NodeJS.ProcessEnv,
): Promise<DesktopRelease> {
  const override = env.RADIUS_APP_MANIFEST?.trim();
  if (!override) return PINNED_DESKTOP_RELEASE;

  let text: string;
  try {
    if (/^https?:\/\//.test(override)) {
      const response = await fetch(override);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      text = await response.text();
    } else {
      text = await readFile(override, "utf8");
    }
  } catch (error) {
    throw new OperationalError(
      `Could not read RADIUS_APP_MANIFEST: ${(error as Error).message}`,
      `It names ${override}. Unset it to use the release this CLI pins.`,
    );
  }
  try {
    return parseDesktopRelease(JSON.parse(text));
  } catch (error) {
    throw new OperationalError(
      `RADIUS_APP_MANIFEST is not a valid radius-desktop.json: ${(error as Error).message}`,
      `It names ${override}.`,
    );
  }
}

export function releasePageUrl(release: DesktopRelease): string {
  return `https://github.com/curve-ai/radius/releases/tag/desktop-v${release.version}`;
}

/**
 * Operating systems the CLI can install the app on. The one place a new
 * platform is switched on, once its installer exists in desktop-install.ts.
 */
const CLI_INSTALLABLE = new Set(["darwin"]);

const OS_NAMES: Readonly<Record<string, string>> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

export type DesktopTarget =
  | {
      readonly supported: true;
      readonly key: string;
      readonly artifact: DesktopArtifact;
    }
  | { readonly supported: false; readonly reason: string };

/**
 * Which build of `release` this machine should install, or why none.
 *
 * Rosetta is asked about rather than trusted from `arch`: an x64 Node running
 * translated on Apple Silicon reports x64, but the machine runs the arm64 app
 * natively, and that is the only Mac build there is.
 */
export async function desktopTarget(
  host: { readonly platform: string; readonly arch: string },
  release: DesktopRelease,
  isTranslated: () => Promise<boolean> = runningUnderRosetta,
): Promise<DesktopTarget> {
  const page = releasePageUrl(release);
  if (!CLI_INSTALLABLE.has(host.platform)) {
    const name = OS_NAMES[host.platform] ?? host.platform;
    return {
      supported: false,
      reason: `Installing the desktop app from the CLI isn't supported on ${name} yet; install it from ${page}`,
    };
  }

  let arch = host.arch;
  if (host.platform === "darwin" && arch === "x64" && (await isTranslated())) {
    arch = "arm64";
  }
  if (host.platform === "darwin" && arch !== "arm64") {
    return {
      supported: false,
      reason:
        "There is no build for Intel Macs; Radius needs Apple Silicon, because its runtime host does.",
    };
  }

  const key = hostPlatformKey(host.platform, arch);
  const artifact = release.platforms[key];
  if (!artifact) {
    return {
      supported: false,
      reason: `Radius ${release.version} has no build for ${key}. See ${page}`,
    };
  }
  return { supported: true, key, artifact };
}

/** `sysctl.proc_translated` is 1 under Rosetta, 0 natively, absent on Intel. */
function runningUnderRosetta(): Promise<boolean> {
  return new Promise((settle) => {
    execFile("sysctl", ["-n", "sysctl.proc_translated"], (error, stdout) => {
      settle(!error && stdout.trim() === "1");
    });
  });
}

/**
 * Orders `a` against `b` as release versions: negative when older.
 *
 * Only what the manifest pattern allows. A pre-release sorts before its
 * release, and two pre-releases compare as strings, which is enough for
 * "is the pin newer than what is installed".
 */
export function compareVersions(a: string, b: string): number {
  const parse = (version: string) => {
    const dash = version.indexOf("-");
    const core = dash === -1 ? version : version.slice(0, dash);
    const pre = dash === -1 ? undefined : version.slice(dash + 1);
    const parts = core.split(".").map((part) => Number.parseInt(part, 10) || 0);
    return { parts, pre };
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index++) {
    const difference = (left.parts[index] ?? 0) - (right.parts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === undefined) return 1;
  if (right.pre === undefined) return -1;
  return left.pre < right.pre ? -1 : 1;
}

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
