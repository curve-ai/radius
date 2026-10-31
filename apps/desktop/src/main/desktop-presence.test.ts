import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { DEVELOPMENT_AGENT_SCHEMA_VERSIONS } from "@curve-ai/radius-runtime";

import {
  desktopPresencePath,
  removeDesktopPresence,
  writeDesktopPresence,
  type DesktopPresence,
} from "./desktop-presence";

function presenceFor(userDataPath: string, pid: number): DesktopPresence {
  return {
    pid,
    version: "0.4.2",
    packaged: true,
    agentNoteVersions: DEVELOPMENT_AGENT_SCHEMA_VERSIONS,
    agentsPath: path.join(userDataPath, "development", "agents"),
  };
}

test("writes a private presence file without leaving temporary files", async (context) => {
  const userData = await mkdtemp(path.join(tmpdir(), "radius-presence-"));
  context.after(() => rm(userData, { force: true, recursive: true }));
  const presence = presenceFor(userData, 4242);

  await writeDesktopPresence(userData, presence);

  const target = desktopPresencePath(userData);
  assert.equal(target, path.join(userData, "development", "desktop.json"));
  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), {
    ...presence,
    agentNoteVersions: [1],
  });
  assert.deepEqual(await readdir(path.dirname(target)), ["desktop.json"]);
  if (process.platform !== "win32") {
    assert.equal((await stat(target)).mode & 0o777, 0o600);
  }
});

test("replaces a presence file left by an earlier launch", async (context) => {
  const userData = await mkdtemp(path.join(tmpdir(), "radius-presence-"));
  context.after(() => rm(userData, { force: true, recursive: true }));

  await writeDesktopPresence(userData, presenceFor(userData, 1));
  await writeDesktopPresence(userData, presenceFor(userData, 2));

  const current = JSON.parse(
    await readFile(desktopPresencePath(userData), "utf8"),
  );
  assert.equal(current.pid, 2);
});

test("removes only the presence this process wrote", async (context) => {
  const userData = await mkdtemp(path.join(tmpdir(), "radius-presence-"));
  context.after(() => rm(userData, { force: true, recursive: true }));
  const target = desktopPresencePath(userData);

  await writeDesktopPresence(userData, presenceFor(userData, 2));
  await removeDesktopPresence(userData, 1);
  assert.equal(JSON.parse(await readFile(target, "utf8")).pid, 2);

  await removeDesktopPresence(userData, 2);
  await assert.rejects(readFile(target), { code: "ENOENT" });

  // Quitting twice, or without ever writing, is not an error.
  await removeDesktopPresence(userData, 2);
});
