import { OperationalError } from "./errors.js";
import {
  DEFAULT_HARNESS_VERSION,
  parseRegistry,
  selectEntry,
  type RegistryEntry,
} from "./registry.js";

/**
 * Which versions of a harness Radius stands behind.
 *
 * The ACP registry serves only each harness's current version, so its newest
 * is not necessarily one a Radius project can run: opencode 2.x starts, answers
 * the handshake and advertises the project's agents, and then fails every
 * custom tool call. A harness with no entry here takes whatever the registry
 * offers.
 */
export interface HarnessSupport {
  /** The lowest supported version. */
  readonly from: string;
  /** The first version past the supported range. */
  readonly before: string;
  /** How the range reads in a message, e.g. `1.x`. */
  readonly range: string;
  /** Why versions outside the range are unsupported. */
  readonly reason: string;
  /**
   * The newest supported version Radius can install when the registry has
   * moved past the range. The registry cannot supply it any more, so the URLs
   * and digests are carried here, the way `PINNED_DESKTOP_RELEASE` carries the
   * app's. Without one, an out-of-range registry version is an error.
   */
  readonly pinned?: RegistryEntry;
}

const OPENCODE_RELEASE =
  "https://github.com/anomalyco/opencode/releases/download/v1.19.4";

export const HARNESS_SUPPORT: ReadonlyMap<string, HarnessSupport> = new Map([
  [
    "opencode",
    {
      // 2.0.0 is the proven edge. Below it the V1 tool format holds across the
      // line, so `from` marks where that line starts, not a known-bad boundary.
      from: "1.0.0",
      before: "2.0.0",
      range: "1.x",
      reason:
        'opencode 2.x does not load V1 custom tools or plugins, so a project\'s .opencode/tool/*.ts fail when called, with `No tool named "…"`.',
      // The registry's entry for 1.19.4 (agentclientprotocol/registry at
      // 3278f65c8a), translated by `selectEntry`. Each digest was checked three
      // ways: the registry's value, GitHub's asset digest for the v1.19.4
      // release, and the SHA-256 of the downloaded archive. To move this,
      // repeat those checks for the new version.
      pinned: {
        id: "opencode",
        name: "OpenCode",
        version: "1.19.4",
        license: "MIT",
        licenseUrl: "https://github.com/anomalyco/opencode/blob/dev/LICENSE",
        distribution: {
          kind: "binary",
          platforms: {
            "darwin/arm64": {
              archive: `${OPENCODE_RELEASE}/opencode-darwin-arm64.zip`,
              sha256:
                "c400a2f8c8ab7e99478a7f4dd1a466b57bf33888e520d85c55780a5464c4b689",
            },
            "darwin/amd64": {
              archive: `${OPENCODE_RELEASE}/opencode-darwin-x64.zip`,
              sha256:
                "123ebd72609c4f8dbae0485cdac39b9aedfeb6576b2eef64f2e73152b1de82f4",
            },
            "linux/arm64": {
              archive: `${OPENCODE_RELEASE}/opencode-linux-arm64.tar.gz`,
              sha256:
                "8568230ccd847dc93e95b9f6894379077d3e014a16b48040743573e77c23e85f",
            },
            "linux/amd64": {
              archive: `${OPENCODE_RELEASE}/opencode-linux-x64.tar.gz`,
              sha256:
                "849bd6b3d959a1d2ef200ed1634a51c79a45ca236aa26665d75debd694805cce",
            },
            "windows/arm64": {
              archive: `${OPENCODE_RELEASE}/opencode-windows-arm64.zip`,
              sha256:
                "36e696fd1d275b469ab02a1ccc00d161bfdcc0a4ffa93c2b7a4e57399f3ff347",
              cmd: "./opencode.exe",
              args: ["acp"],
            },
            "windows/amd64": {
              archive: `${OPENCODE_RELEASE}/opencode-windows-x64.zip`,
              sha256:
                "93b899277bd6f68803009e32bf71772ce43c34b18adf1e93b9b4d8780fdf62e5",
              cmd: "./opencode.exe",
              args: ["acp"],
            },
          },
          // After `platforms`, as `selectEntry` writes it: a lock is rendered
          // in key order, so any other order rewrites it on the next `init`.
          cmd: "./opencode",
          args: ["acp"],
        },
      },
    },
  ],
]);

/**
 * Release versions only. A prerelease is never supported, even inside the
 * range: `2.0.0-beta.1` sorts below 2.0.0 and is exactly what the range
 * excludes.
 */
function parseRelease(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative, zero or positive, as `a` sorts before, with or after `b`. */
function compareReleases(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function isSupported(support: HarnessSupport, version: string): boolean {
  const release = parseRelease(version);
  const from = parseRelease(support.from);
  const before = parseRelease(support.before);
  if (!release || !from || !before) return false;
  return (
    compareReleases(release, from) >= 0 && compareReleases(release, before) < 0
  );
}

/**
 * Why this pin is outside what Radius supports, or undefined when it is fine
 * or the harness declares no range.
 */
export function describeUnsupported(
  id: string,
  version: string,
  table: ReadonlyMap<string, HarnessSupport> = HARNESS_SUPPORT,
): string | undefined {
  const support = table.get(id);
  if (!support || isSupported(support, version)) return undefined;
  return `${id} ${version} is not a version Radius supports (${support.range}). ${support.reason}`;
}

export interface ResolvedEntry {
  readonly entry: RegistryEntry;
  /** Set when the registry's version was passed over, saying what and why. */
  readonly note?: string;
}

/**
 * What `init` pins: the newest supported version it can name a digest for.
 *
 * Takes the registry's entry when that is in range and at least as new as the
 * carried pin, and otherwise the carried pin. It never falls back to an
 * unsupported version: with neither available it throws, before anything is
 * written.
 */
export function resolveEntry(
  document: unknown,
  id: string,
  table: ReadonlyMap<string, HarnessSupport> = HARNESS_SUPPORT,
): ResolvedEntry {
  const support = table.get(id);
  if (!support) return { entry: selectEntry(document, id) };

  const listed = parseRegistry(document).agents.find(
    (candidate) => candidate.id === id,
  );
  // Absent from the registry: selectEntry reports that, as for any harness.
  if (!listed) return { entry: selectEntry(document, id) };

  const offered = listed.version ?? DEFAULT_HARNESS_VERSION;
  const { pinned } = support;
  if (isSupported(support, offered)) {
    const offeredRelease = parseRelease(offered)!;
    const pinnedRelease = pinned && parseRelease(pinned.version);
    if (pinnedRelease && compareReleases(offeredRelease, pinnedRelease) < 0) {
      return { entry: pinned };
    }
    return { entry: selectEntry(document, id) };
  }

  if (pinned) {
    return {
      entry: pinned,
      note: `the ACP registry offers ${id} ${offered}, which Radius does not support (${support.range}), so ${pinned.version} was pinned instead. ${support.reason}`,
    };
  }
  throw new OperationalError(
    `The ACP registry offers ${id} ${offered}, which Radius does not support (${support.range}), and this CLI carries no supported version to pin instead. Nothing was written. ${support.reason}`,
    `Update the Radius CLI, which may carry one. To run ${id} ${offered} anyway, write its distribution into radius.json under \`runtime\` by hand; \`radius check\` will report it as unsupported.`,
  );
}
