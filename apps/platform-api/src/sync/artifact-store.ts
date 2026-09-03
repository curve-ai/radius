import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ArtifactStore {
  has(contentSha256: string): Promise<boolean>;
  put(contentSha256: string, bytes: Uint8Array): Promise<string>;
  get(contentSha256: string): Promise<Buffer>;
}

class FileSystemArtifactStore implements ArtifactStore {
  constructor(private readonly root: string) {}

  #path(contentSha256: string): string {
    if (!/^[a-f0-9]{64}$/.test(contentSha256))
      throw new Error("INVALID_ARTIFACT_HASH");
    return path.join(this.root, contentSha256.slice(0, 2), contentSha256);
  }

  async has(contentSha256: string): Promise<boolean> {
    try {
      await stat(this.#path(contentSha256));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async put(contentSha256: string, bytes: Uint8Array): Promise<string> {
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== contentSha256) throw new Error("ARTIFACT_HASH_MISMATCH");
    const destination = this.#path(contentSha256);
    await mkdir(path.dirname(destination), { recursive: true });
    if (!(await this.has(contentSha256))) {
      const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, destination);
    }
    return `sha256:${contentSha256}`;
  }

  get(contentSha256: string): Promise<Buffer> {
    return readFile(this.#path(contentSha256));
  }
}

export function createFileSystemArtifactStore(root: string): ArtifactStore {
  return new FileSystemArtifactStore(path.resolve(root));
}

let artifactStore: ArtifactStore | null | undefined;

export function getArtifactStore(): ArtifactStore | null {
  if (artifactStore !== undefined) return artifactStore;
  const configuredPath = process.env.RADIUS_SYNC_ARTIFACT_PATH?.trim();
  artifactStore = configuredPath
    ? createFileSystemArtifactStore(configuredPath)
    : null;
  return artifactStore;
}
