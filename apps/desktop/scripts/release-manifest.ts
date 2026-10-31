// Writes radius-desktop.json, the only thing the radius CLI reads to install
// the desktop app. Its shape is documented in release-manifest.schema.json;
// change both together, and only in ways an older CLI still accepts.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { DEVELOPMENT_AGENT_SCHEMA_VERSIONS } from "../../../packages/runtime/src/development.js";

export type PlatformKey =
  "darwin/arm64" | "darwin/amd64" | "windows/amd64" | "linux/amd64";

export interface ReleaseArtifact {
  url: string;
  sha256: string;
  size: number;
}

export interface ReleaseManifest {
  version: string;
  agentNoteVersions: readonly number[];
  platforms: Partial<Record<PlatformKey, ReleaseArtifact>>;
}

// The archive the CLI installs on each platform, named by the artifactName
// settings in electron-builder.config.cjs. Installers such as the dmg and the
// NSIS setup are for people and are never listed. macOS on Intel is absent
// because the runtime host only builds for Apple Silicon.
export const PLATFORM_ARCHIVES: Partial<
  Record<PlatformKey, (version: string) => string>
> = {
  "darwin/arm64": (version) => `radius-${version}-mac-arm64.zip`,
  "windows/amd64": (version) => `radius-${version}-win-x64.zip`,
  "linux/amd64": (version) => `radius-${version}-linux-x86_64.AppImage`,
};

const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;

export function releaseTag(version: string): string {
  return `desktop-v${version}`;
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function buildReleaseManifest(input: {
  version: string;
  repository: string;
  artifactsDirectory: string;
  platforms: readonly PlatformKey[];
  agentNoteVersions?: readonly number[];
}): Promise<ReleaseManifest> {
  if (!VERSION_PATTERN.test(input.version))
    throw new Error(`Invalid desktop version: ${input.version}`);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository))
    throw new Error(`Invalid repository: ${input.repository}`);
  if (input.platforms.length === 0)
    throw new Error("A release needs at least one platform");

  const agentNoteVersions =
    input.agentNoteVersions ?? DEVELOPMENT_AGENT_SCHEMA_VERSIONS;
  if (agentNoteVersions.length === 0)
    throw new Error("The app must read at least one agent descriptor version");

  const platforms: Partial<Record<PlatformKey, ReleaseArtifact>> = {};
  for (const platform of input.platforms) {
    const archiveName = PLATFORM_ARCHIVES[platform]?.(input.version);
    if (!archiveName) throw new Error(`No release archive for ${platform}`);
    const file = path.join(input.artifactsDirectory, archiveName);
    const size = (await stat(file)).size;
    if (size === 0) throw new Error(`${archiveName} is empty`);
    platforms[platform] = {
      url: `https://github.com/${input.repository}/releases/download/${releaseTag(input.version)}/${encodeURIComponent(archiveName)}`,
      sha256: await sha256Of(file),
      size,
    };
  }

  return {
    version: input.version,
    agentNoteVersions: [...agentNoteVersions],
    platforms,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      artifacts: { type: "string" },
      output: { type: "string" },
      repository: { type: "string", default: "curve-ai/radius" },
      platform: { type: "string", multiple: true },
      tag: { type: "string" },
    },
  });
  if (!values.artifacts || !values.output)
    throw new Error(
      "Usage: release-manifest.ts --artifacts DIR --output FILE [--platform darwin/arm64 ...] [--tag desktop-vX.Y.Z]",
    );

  const desktopPackage = JSON.parse(
    await readFile(
      fileURLToPath(new URL("../package.json", import.meta.url)),
      "utf8",
    ),
  ) as { version: string };
  const version = desktopPackage.version;
  // The updater and the CLI both trust the tag to name the version inside it.
  if (values.tag && values.tag !== releaseTag(version))
    throw new Error(
      `Tag ${values.tag} does not match apps/desktop/package.json version ${version}`,
    );

  const knownPlatforms = Object.keys(PLATFORM_ARCHIVES) as PlatformKey[];
  const platforms = (values.platform ?? knownPlatforms).map((platform) => {
    if (!knownPlatforms.includes(platform as PlatformKey))
      throw new Error(`Unknown platform ${platform}`);
    return platform as PlatformKey;
  });

  const manifest = await buildReleaseManifest({
    version,
    repository: values.repository,
    artifactsDirectory: values.artifacts,
    platforms,
  });
  await writeFile(values.output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
