import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

import { canonicalJson } from "./manifest.js";
import type { HostImagePlatform } from "./host-image.js";

/** Docker Desktop's load/save path may emit a Docker archive rather than OCI. */
export async function normalizeDockerArchive(input: {
  layoutPath: string;
  imageReference: string;
  platform: HostImagePlatform;
}): Promise<void> {
  try {
    await access(join(input.layoutPath, "index.json"));
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const entries = JSON.parse(
    await readFile(join(input.layoutPath, "manifest.json"), "utf8"),
  ) as Array<{ Config: string; RepoTags?: string[]; Layers: string[] }>;
  const matching = entries.filter((entry) =>
    entry.RepoTags?.includes(input.imageReference),
  );
  if (matching.length !== 1)
    throw new Error(
      `Docker archive does not uniquely name ${input.imageReference}`,
    );
  const entry = matching[0]!;
  const source = (name: string): string => {
    const path = resolve(input.layoutPath, name);
    const within = relative(resolve(input.layoutPath), path);
    if (
      isAbsolute(name) ||
      isAbsolute(within) ||
      within === ".." ||
      within.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    ) {
      throw new Error("Docker archive member escapes its layout");
    }
    return path;
  };
  const configPath = source(entry.Config);
  const config = JSON.parse(await readFile(configPath, "utf8")) as {
    os: string;
    architecture: string;
  };
  if (`${config.os}/${config.architecture}` !== input.platform) {
    throw new Error(
      `Docker archive is ${config.os}/${config.architecture}, expected ${input.platform}`,
    );
  }
  const blobs = join(input.layoutPath, "blobs", "sha256");
  await mkdir(blobs, { recursive: true });
  async function store(path: string, mediaType: string) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    const hex = hash.digest("hex");
    const destination = join(blobs, hex);
    if (resolve(path) !== resolve(destination))
      await copyFile(path, destination);
    return {
      mediaType,
      digest: `sha256:${hex}`,
      size: (await stat(path)).size,
    };
  }
  const configDescriptor = await store(
    configPath,
    "application/vnd.oci.image.config.v1+json",
  );
  const layers = [];
  const scratch = await mkdtemp(join(input.layoutPath, ".oci-layers-"));
  try {
    for (const [position, name] of entry.Layers.entries()) {
      const compressed = join(scratch, `${position}.tar.gz`);
      // Docker save layers are uncompressed. OCI build-size accounting and
      // the guest importer expect the same compressed layers buildx emits.
      await pipeline(
        createReadStream(source(name)),
        createGzip(),
        createWriteStream(compressed),
      );
      layers.push(
        await store(compressed, "application/vnd.oci.image.layer.v1.tar+gzip"),
      );
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  const manifest = {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: configDescriptor,
    layers,
  };
  const bytes = canonicalJson(manifest);
  const hex = createHash("sha256").update(bytes).digest("hex");
  await writeFile(join(blobs, hex), bytes);
  await writeFile(
    join(input.layoutPath, "oci-layout"),
    canonicalJson({ imageLayoutVersion: "1.0.0" }),
  );
  await writeFile(
    join(input.layoutPath, "index.json"),
    canonicalJson({
      schemaVersion: 2,
      manifests: [
        {
          mediaType: manifest.mediaType,
          digest: `sha256:${hex}`,
          size: Buffer.byteLength(bytes),
          platform: { os: config.os, architecture: config.architecture },
        },
      ],
    }),
  );
  // Do not ship the original uncompressed Docker archive beside the OCI
  // blobs. Keep the config if Docker already stored it by its blob digest.
  const retainedConfig = join(blobs, configDescriptor.digest.slice(7));
  for (const path of new Set([configPath, ...entry.Layers.map(source)])) {
    if (resolve(path) !== resolve(retainedConfig))
      await rm(path, { force: true });
  }
  await rm(join(input.layoutPath, "manifest.json"));
}
