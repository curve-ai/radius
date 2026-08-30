import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { createSeatbeltCommand } from "./seatbelt-policy";

const execFileAsync = promisify(execFile);

test("builds a closed-network Seatbelt command with explicit roots", async () => {
  const command = createSeatbeltCommand({
    command: "/bin/pwd",
    args: [],
    cwd: "/workspace",
    readableRoots: ["/workspace", "/source"],
    writableRoots: ["/workspace"],
  });

  assert.equal(command.program, "/usr/bin/sandbox-exec");
  assert.ok(command.args.includes("-DREADABLE_ROOT_0=/source"));
  assert.ok(command.args.includes("-DREADABLE_ROOT_1=/workspace"));
  assert.ok(command.args.includes("-DWRITABLE_ROOT_0=/workspace"));
  assert.match(command.args[1] ?? "", /\(deny network\*\)/);
  assert.deepEqual(command.args.slice(-2), ["--", "/bin/pwd"]);
});

test(
  "macOS Seatbelt denies an unapproved folder and accepts an approved one",
  { skip: process.platform !== "darwin" },
  async (context) => {
    const root = await realpath(
      await mkdtemp(path.join(tmpdir(), "radius-seatbelt-root-")),
    );
    const external = await realpath(
      await mkdtemp(
        path.join(process.env.HOME ?? tmpdir(), ".radius-seatbelt-external-"),
      ),
    );
    context.after(async () => {
      await rm(root, { force: true, recursive: true });
      await rm(external, { force: true, recursive: true });
    });
    await mkdir(path.join(root, "output"));
    await writeFile(path.join(external, "value.txt"), "external\n", "utf8");

    const denied = createSeatbeltCommand({
      command: "/bin/cat",
      args: [path.join(external, "value.txt")],
      cwd: root,
      readableRoots: [root],
      writableRoots: [root],
    });
    await assert.rejects(
      execFileAsync(denied.program, denied.args, { cwd: root }),
    );
    const deniedWrite = createSeatbeltCommand({
      command: "/usr/bin/touch",
      args: [path.join(external, "blocked.txt")],
      cwd: root,
      readableRoots: [root],
      writableRoots: [root],
    });
    await assert.rejects(
      execFileAsync(deniedWrite.program, deniedWrite.args, { cwd: root }),
    );

    const allowed = createSeatbeltCommand({
      command: "/bin/cat",
      args: [path.join(external, "value.txt")],
      cwd: external,
      readableRoots: [root, external],
      writableRoots: [root, external],
    });
    const result = await execFileAsync(allowed.program, allowed.args, {
      cwd: external,
    });
    assert.equal(result.stdout, "external\n");

    const allowedWrite = createSeatbeltCommand({
      command: "/usr/bin/touch",
      args: [path.join(external, "allowed.txt")],
      cwd: external,
      readableRoots: [root, external],
      writableRoots: [root, external],
    });
    await execFileAsync(allowedWrite.program, allowedWrite.args, {
      cwd: external,
    });
  },
);
