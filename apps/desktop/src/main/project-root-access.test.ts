import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalizeProjectRoot,
  resolveProjectPath,
} from "./project-root-access";

test("allows existing and new paths within the project root", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "radius-project-root-"));
  try {
    const root = path.join(directory, "project");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "index.ts"), "export {};\n");
    const canonicalRoot = await canonicalizeProjectRoot(root);

    assert.equal(canonicalRoot.endsWith(`${path.sep}project`), true);
    assert.equal(
      await resolveProjectPath(root, "src/index.ts"),
      path.join(canonicalRoot, "src", "index.ts"),
    );
    assert.equal(
      await resolveProjectPath(root, "src/new/file.ts", {
        allowMissing: true,
      }),
      path.join(canonicalRoot, "src", "new", "file.ts"),
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("rejects traversal and symlinks that escape the project root", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "radius-project-root-"));
  try {
    const root = path.join(directory, "project");
    const outside = path.join(directory, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "secret\n");
    await symlink(outside, path.join(root, "escape"));

    await assert.rejects(
      resolveProjectPath(root, "../outside/secret.txt"),
      /escapes the project root/,
    );
    await assert.rejects(
      resolveProjectPath(root, "escape/secret.txt"),
      /outside the project root/,
    );
    await assert.rejects(
      resolveProjectPath(root, "escape/new.txt", { allowMissing: true }),
      /outside the project root/,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
