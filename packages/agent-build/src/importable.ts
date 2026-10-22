import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson } from "./manifest.js";

interface OciDescriptor {
  digest?: string;
  size?: number;
  mediaType?: string;
  platform?: { os?: string; architecture?: string; variant?: string };
  annotations?: Record<string, string>;
}

export interface ImportableLayoutInput {
  readonly layoutPath: string;
  readonly imageReference: string;
  readonly platform: "linux/arm64" | "linux/amd64";
  readonly agentId: string;
  readonly outputRoot: string;
}

export interface ImportableLayoutResult {
  readonly imageDigest: `sha256:${string}`;
  readonly indexPath: string;
  readonly imageSizeMb: number;
}

/**
 * Layer blobs are stored compressed, so their size understates the rootfs an
 * agent actually needs. This multiplier turns the compressed total into a
 * generous estimate: `rootfsMb` sizes a sparse filesystem, so overshooting
 * costs nothing while undershooting stops the guest booting.
 */
const DECOMPRESSION_FACTOR = 4;

/** Sums a layout's blob sizes, in MB, as an estimate of the unpacked image. */
export async function measureLayoutMb(
  layoutPath: string,
  manifest: { layers?: Array<{ size?: number }> },
): Promise<number> {
  let compressed = 0;
  for (const layer of manifest.layers ?? []) {
    if (typeof layer.size === "number") compressed += layer.size;
  }
  if (compressed === 0) {
    // No sizes in the manifest: fall back to the blobs on disk.
    try {
      const stats = await stat(join(layoutPath, "blobs", "sha256"));
      compressed = stats.size;
    } catch {
      /* leave at zero; the caller still adds headroom */
    }
  }
  return (compressed * DECOMPRESSION_FACTOR) / (1024 * 1024);
}

/**
 * Turns a plain buildx OCI layout into the shape the desktop importer accepts.
 *
 * Two things are missing from what buildx emits. The manifest descriptor needs
 * the `io.containerd.image.name` annotation the importer reads the reference
 * from, and the layout needs a sibling index entry naming it. Both live in
 * `index.json` or beside it, never inside a hashed blob, so writing them does
 * not invalidate any digest — which is why the template has to go in through a
 * build label instead.
 */
export async function writeImportableLayout(
  input: ImportableLayoutInput,
): Promise<ImportableLayoutResult> {
  const indexFile = join(input.layoutPath, "index.json");
  const index = JSON.parse(await readFile(indexFile, "utf8")) as {
    manifests?: OciDescriptor[];
  };
  const manifests = index.manifests ?? [];
  const descriptor = selectManifest(manifests, input.platform);

  const digest = descriptor.digest;
  if (!digest || !/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new Error("OCI build did not produce a digest-pinned manifest");
  }

  const manifestJson = JSON.parse(
    await readFile(
      join(input.layoutPath, "blobs", ...digest.replace(":", "/").split("/")),
      "utf8",
    ),
  ) as { layers?: Array<{ size?: number }> };
  const imageSizeMb = await measureLayoutMb(input.layoutPath, manifestJson);

  descriptor.annotations = {
    ...descriptor.annotations,
    "io.containerd.image.name": input.imageReference,
    "org.opencontainers.image.ref.name":
      input.imageReference.split(":").pop() ?? input.imageReference,
  };
  await writeFile(indexFile, `${canonicalJson(index)}\n`, "utf8");

  // The importer requires a notices directory. An agent with no third-party
  // notices still gets the directory, so its absence always means a broken
  // layout rather than an agent that happened to have nothing to declare.
  await mkdir(join(input.outputRoot, "notices"), { recursive: true });

  const indexPath = join(input.outputRoot, "index.json");
  await writeFile(
    indexPath,
    `${canonicalJson({
      schemaVersion: 1,
      agents: [{ project: input.agentId, imageLayout: "oci-layout" }],
    })}\n`,
    "utf8",
  );

  return { imageDigest: digest as `sha256:${string}`, indexPath, imageSizeMb };
}

/**
 * Picks the manifest for a platform rather than taking the first.
 *
 * Taking `manifests[0]` works only while every index has exactly one entry.
 * The moment a multi-arch build emits both architectures it silently records
 * whichever buildx listed first, and the importer then installs one
 * architecture while the bundle claims two.
 */
export function selectManifest(
  manifests: readonly OciDescriptor[],
  platform: "linux/arm64" | "linux/amd64",
): OciDescriptor {
  const [os, architecture] = platform.split("/");
  const matches = manifests.filter(
    (candidate) =>
      candidate.platform?.os === os &&
      candidate.platform?.architecture === architecture,
  );
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new Error(`OCI index carries more than one ${platform} manifest`);
  }
  // An index with a single unlabelled entry is what a single-platform buildx
  // run produces; anything else is ambiguous and must fail loudly.
  if (manifests.length === 1 && !manifests[0]!.platform) return manifests[0]!;
  throw new Error(
    `OCI index carries no ${platform} manifest (found: ${
      manifests
        .map((m) =>
          m.platform ? `${m.platform.os}/${m.platform.architecture}` : "unknown",
        )
        .join(", ") || "none"
    })`,
  );
}
