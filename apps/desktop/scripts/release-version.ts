// Picks the version a desktop release cut publishes and writes it into
// apps/desktop/package.json. Released versions live in desktop-v* tags, not on
// main, so the newest stable tag is the base rather than package.json.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export type ReleaseKind = "patch" | "minor" | "major";

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[];
}

const VERSION_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parseVersion(value: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(value);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = /^[0-9]+$/.test(left);
  const rightNumeric = /^[0-9]+$/.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Semantic version precedence; a prerelease sorts before its release. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`Invalid version: ${!a ? left : right}`);
  for (let index = 0; index < 3; index += 1) {
    const difference = a.core[index]! - b.core[index]!;
    if (difference !== 0) return difference;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0)
    return b.prerelease.length - a.prerelease.length;
  for (
    let index = 0;
    index < Math.min(a.prerelease.length, b.prerelease.length);
    index += 1
  ) {
    const difference = compareIdentifiers(
      a.prerelease[index]!,
      b.prerelease[index]!,
    );
    if (difference !== 0) return difference;
  }
  return a.prerelease.length - b.prerelease.length;
}

function bump(version: string, kind: ReleaseKind): string {
  const [major, minor, patch] = parseVersion(version)!.core;
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function nextDesktopVersion(input: {
  tags: readonly string[];
  packageVersion: string;
  kind: ReleaseKind;
  explicitVersion?: string;
}): string {
  const released = input.tags
    .filter((tag) => tag.startsWith("desktop-v"))
    .map((tag) => tag.slice("desktop-v".length))
    .filter((version) => parseVersion(version) !== null);
  const latestStable = released
    .filter((version) => parseVersion(version)!.prerelease.length === 0)
    .sort(compareVersions)
    .at(-1);

  if (input.explicitVersion) {
    if (!parseVersion(input.explicitVersion))
      throw new Error(`Invalid version: ${input.explicitVersion}`);
    if (released.includes(input.explicitVersion))
      throw new Error(`desktop-v${input.explicitVersion} already exists`);
    // The updater never moves backwards, so a lower version would strand
    // everyone who installed the newer one.
    if (
      latestStable &&
      compareVersions(input.explicitVersion, latestStable) <= 0
    )
      throw new Error(
        `${input.explicitVersion} is not newer than the latest release ${latestStable}`,
      );
    return input.explicitVersion;
  }

  // Before the first release there is no tag, so package.json is the base.
  const base = latestStable ?? input.packageVersion;
  if (!parseVersion(base)) throw new Error(`Invalid base version: ${base}`);
  const next = bump(base, input.kind);
  if (released.includes(next))
    throw new Error(`desktop-v${next} already exists`);
  return next;
}

/** Replaces only the version value, so the file keeps its formatting. */
export function withPackageVersion(source: string, version: string): string {
  const pattern = /^(\s*"version"\s*:\s*")[^"]*(")/m;
  if (!pattern.test(source)) throw new Error("package.json has no version");
  return source.replace(pattern, `$1${version}$2`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      kind: { type: "string", default: "patch" },
      version: { type: "string" },
      write: { type: "boolean", default: false },
    },
  });
  if (!["patch", "minor", "major"].includes(values.kind))
    throw new Error(`Unknown release kind ${values.kind}`);

  const packagePath = fileURLToPath(
    new URL("../package.json", import.meta.url),
  );
  const source = await readFile(packagePath, "utf8");
  const tags = execFileSync("git", ["tag", "--list", "desktop-v*"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  const version = nextDesktopVersion({
    tags,
    packageVersion: (JSON.parse(source) as { version: string }).version,
    kind: values.kind as ReleaseKind,
    explicitVersion: values.version || undefined,
  });
  if (values.write)
    await writeFile(packagePath, withPackageVersion(source, version));
  console.log(version);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
