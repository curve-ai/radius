import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeContentAddressedFile(input: {
  bytes: Buffer;
  conflictCode: string;
  contentSha256: string;
  targetPath: string;
}): Promise<void> {
  await mkdir(path.dirname(input.targetPath), { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    path.dirname(input.targetPath),
    `.${path.basename(input.targetPath)}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporaryPath, input.bytes, { flag: "wx", mode: 0o600 });
    try {
      await link(temporaryPath, input.targetPath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    const existing = await readFile(input.targetPath);
    if (
      existing.byteLength !== input.bytes.byteLength ||
      createHash("sha256").update(existing).digest("hex") !==
        input.contentSha256
    ) {
      throw new Error(input.conflictCode);
    }
  } finally {
    await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
