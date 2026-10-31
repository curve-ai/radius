import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildReleaseManifest,
  PLATFORM_ARCHIVES,
  type PlatformKey,
} from "./release-manifest";

const schema = JSON.parse(
  await readFile(
    new URL("./release-manifest.schema.json", import.meta.url),
    "utf8",
  ),
);

async function withArtifacts(
  files: Record<string, string>,
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "radius-release-"));
  try {
    for (const [name, content] of Object.entries(files))
      await writeFile(path.join(directory, name), content);
    await run(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test("hashes each platform archive and links it under the release tag", async () => {
  await withArtifacts(
    {
      "radius-0.4.2-mac-arm64.zip": "mac",
      "radius-0.4.2-win-x64.zip": "windows",
      "radius-0.4.2-linux-x86_64.AppImage": "linux",
      // Installers and updater metadata sit beside them but are not listed.
      "radius-0.4.2.dmg": "dmg",
      "radius-0.4.2-setup.exe": "nsis",
    },
    async (directory) => {
      const manifest = await buildReleaseManifest({
        version: "0.4.2",
        repository: "curve-ai/radius",
        artifactsDirectory: directory,
        platforms: ["darwin/arm64", "windows/amd64", "linux/amd64"],
      });

      assert.equal(manifest.version, "0.4.2");
      assert.deepEqual(manifest.agentNoteVersions, [1]);
      assert.deepEqual(Object.keys(manifest.platforms).sort(), [
        "darwin/arm64",
        "linux/amd64",
        "windows/amd64",
      ]);
      assert.deepEqual(manifest.platforms["windows/amd64"], {
        url: "https://github.com/curve-ai/radius/releases/download/desktop-v0.4.2/radius-0.4.2-win-x64.zip",
        sha256: createHash("sha256").update("windows").digest("hex"),
        size: "windows".length,
      });
    },
  );
});

test("fails rather than publishing a manifest with a missing platform", async () => {
  await withArtifacts({ "radius-0.4.2-mac-arm64.zip": "mac" }, (directory) =>
    assert.rejects(
      buildReleaseManifest({
        version: "0.4.2",
        repository: "curve-ai/radius",
        artifactsDirectory: directory,
        platforms: ["darwin/arm64", "linux/amd64"],
      }),
      { code: "ENOENT" },
    ),
  );
});

test("refuses empty archives, bad versions and unbuilt platforms", async () => {
  await withArtifacts(
    { "radius-0.4.2-mac-arm64.zip": "" },
    async (directory) => {
      const base = {
        version: "0.4.2",
        repository: "curve-ai/radius",
        artifactsDirectory: directory,
      };
      await assert.rejects(
        buildReleaseManifest({ ...base, platforms: ["darwin/arm64"] }),
        /empty/,
      );
      await assert.rejects(
        buildReleaseManifest({
          ...base,
          version: "v0.4.2",
          platforms: ["darwin/arm64"],
        }),
        /Invalid desktop version/,
      );
      await assert.rejects(
        buildReleaseManifest({ ...base, platforms: ["darwin/amd64"] }),
        /No release archive/,
      );
      await assert.rejects(
        buildReleaseManifest({ ...base, platforms: [] }),
        /at least one platform/,
      );
    },
  );
});

test("stays within the documented schema", async () => {
  const keyPattern = new RegExp(
    schema.properties.platforms.propertyNames.pattern,
  );
  const urlPattern = new RegExp(schema.$defs.artifact.properties.url.pattern);
  const versionPattern = new RegExp(schema.properties.version.pattern);
  for (const key of Object.keys(PLATFORM_ARCHIVES) as PlatformKey[])
    assert.match(key, keyPattern);

  await withArtifacts(
    { "radius-1.0.0-beta.1-linux-x86_64.AppImage": "linux" },
    async (directory) => {
      const manifest = await buildReleaseManifest({
        version: "1.0.0-beta.1",
        repository: "curve-ai/radius",
        artifactsDirectory: directory,
        platforms: ["linux/amd64"],
      });
      assert.deepEqual(
        Object.keys(manifest).sort(),
        [...schema.required].sort(),
      );
      assert.match(manifest.version, versionPattern);
      const artifact = manifest.platforms["linux/amd64"]!;
      assert.deepEqual(
        Object.keys(artifact).sort(),
        [...schema.$defs.artifact.required].sort(),
      );
      assert.match(artifact.url, urlPattern);
    },
  );
});
