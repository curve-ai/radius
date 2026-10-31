import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { installedByNsis } from "./update-install";

test("recognizes an installer copy by its uninstaller", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "radius-install-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const executable = path.join(directory, "radius.exe");
  await writeFile(executable, "");

  assert.equal(await installedByNsis(executable), false);

  await writeFile(path.join(directory, "Uninstall Radius.exe"), "");
  assert.equal(await installedByNsis(executable), true);
});

test("treats an unreadable location as not installed", async () => {
  assert.equal(
    await installedByNsis(path.join(tmpdir(), "radius-missing", "radius.exe")),
    false,
  );
});
