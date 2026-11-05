import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  readDesktopPresence,
  waitForDesktopPresence,
} from "./desktop-presence.js";
import { writePresence } from "./test-desktop.js";

/** A pid that was real a moment ago and is not any more. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await once(child, "exit");
  return child.pid!;
}

function presence(userData: string, pid: number) {
  return {
    pid,
    version: "0.1.0",
    packaged: true,
    agentNoteVersions: [1],
    agentsPath: join(userData, "elsewhere", "agents"),
  };
}

test("a live presence is read, agentsPath and all", async () => {
  const userData = await mkdtemp(join(tmpdir(), "radius-presence-"));
  await writePresence(userData, presence(userData, process.pid));
  const read = await readDesktopPresence(userData);
  assert.equal(read?.pid, process.pid);
  assert.equal(read?.agentsPath, join(userData, "elsewhere", "agents"));
});

test("a presence left by a crashed app is stale", async () => {
  const userData = await mkdtemp(join(tmpdir(), "radius-presence-"));
  await writePresence(userData, presence(userData, await deadPid()));
  assert.equal(await readDesktopPresence(userData), null);
});

test("missing or malformed presence counts as no app", async () => {
  const userData = await mkdtemp(join(tmpdir(), "radius-presence-"));
  assert.equal(await readDesktopPresence(userData), null);
  await writePresence(userData, { pid: process.pid });
  assert.equal(await readDesktopPresence(userData), null);
});

test("waiting returns once the app reports in, and null on timeout", async () => {
  const userData = await mkdtemp(join(tmpdir(), "radius-presence-"));
  assert.equal(
    await waitForDesktopPresence(userData, 100, { intervalMs: 20 }),
    null,
  );
  setTimeout(() => {
    void writePresence(userData, presence(userData, process.pid));
  }, 50);
  const arrived = await waitForDesktopPresence(userData, 5_000, {
    intervalMs: 20,
  });
  assert.equal(arrived?.pid, process.pid);
});
