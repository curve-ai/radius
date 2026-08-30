import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { HostFileSystemManager } from "./file-system-access";

test("reads project files and requests exact external write access", async (context) => {
  const projectRoot = await realpath(
    await mkdtemp(path.join(tmpdir(), "radius-fs-project-")),
  );
  const externalRoot = await realpath(
    await mkdtemp(path.join(tmpdir(), "radius-fs-external-")),
  );
  const projectFile = path.join(projectRoot, "notes.txt");
  const externalFile = path.join(externalRoot, "output.txt");
  context.after(async () => {
    await rm(projectRoot, { force: true, recursive: true });
    await rm(externalRoot, { force: true, recursive: true });
  });
  await writeFile(projectFile, "one\ntwo\nthree\n", "utf8");
  const requests: Array<{
    operation: "read" | "write";
    outsideProjectRoots: boolean;
  }> = [];
  const results: boolean[] = [];
  const manager = new HostFileSystemManager({
    projectRoots: [projectRoot],
    authorize: async (request) => {
      requests.push({
        operation: request.operation,
        outsideProjectRoots: request.outsideProjectRoots,
      });
      return `${request.operation}-call`;
    },
    onResult: (result) => {
      results.push(result.succeeded);
    },
  });
  manager.bindSession("session");

  const selected = await manager.readTextFile(
    {
      sessionId: "session",
      path: projectFile,
      line: 2,
      limit: 1,
    },
    new AbortController().signal,
  );
  await manager.writeTextFile(
    {
      sessionId: "session",
      path: externalFile,
      content: "approved\n",
    },
    new AbortController().signal,
  );

  assert.equal(selected.content, "two\n");
  assert.equal(await readFile(externalFile, "utf8"), "approved\n");
  assert.deepEqual(requests, [
    { operation: "read", outsideProjectRoots: false },
    { operation: "write", outsideProjectRoots: true },
  ]);
  assert.deepEqual(results, [true, true]);
});
