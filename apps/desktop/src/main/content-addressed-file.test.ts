import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { writeContentAddressedFile } from "./content-addressed-file";

test("publishes concurrent identical content only after the bytes are complete", async (context) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "radius-content-addressed-file-"),
  );
  context.after(() => rm(directory, { force: true, recursive: true }));
  const bytes = Buffer.alloc(2 * 1024 * 1024, 0x5a);
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const targetPath = path.join(directory, `${contentSha256}.bin`);

  await Promise.all(
    Array.from({ length: 8 }, () =>
      writeContentAddressedFile({
        bytes,
        conflictCode: "STORE_CONFLICT",
        contentSha256,
        targetPath,
      }),
    ),
  );

  assert.deepEqual(await readFile(targetPath), bytes);
  assert.deepEqual(await readdir(directory), [path.basename(targetPath)]);
});

test("rejects an existing target with different bytes", async (context) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "radius-content-addressed-conflict-"),
  );
  context.after(() => rm(directory, { force: true, recursive: true }));
  const bytes = Buffer.from("expected");
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const targetPath = path.join(directory, `${contentSha256}.bin`);
  await writeFile(targetPath, "different", { mode: 0o600 });

  await assert.rejects(
    writeContentAddressedFile({
      bytes,
      conflictCode: "STORE_CONFLICT",
      contentSha256,
      targetPath,
    }),
    /STORE_CONFLICT/,
  );
});
