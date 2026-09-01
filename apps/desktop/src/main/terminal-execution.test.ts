import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { MacOsTerminalManager } from "./terminal-execution";

test(
  "runs an ACP terminal in the project and records a bounded result",
  { skip: process.platform !== "darwin" },
  async (context) => {
    const projectRoot = await realpath(
      await mkdtemp(path.join(tmpdir(), "radius-terminal-project-")),
    );
    const authorizations: boolean[] = [];
    context.after(() => rm(projectRoot, { force: true, recursive: true }));
    const results: Array<{
      exitCode: number | null;
      outputTruncated: boolean;
    }> = [];
    const manager = new MacOsTerminalManager({
      projectRoots: [projectRoot],
      authorize: async (request) => {
        authorizations.push(request.outsideProjectRoots);
        return "tool-call-1";
      },
      onResult: (result) => {
        results.push({
          exitCode: result.exitCode,
          outputTruncated: result.outputTruncated,
        });
      },
    });
    manager.bindSession("acp-session");

    const created = await manager.create(
      {
        sessionId: "acp-session",
        command: "/bin/zsh",
        args: ["-f", "-c", "printf terminal-ready"],
        cwd: projectRoot,
        outputByteLimit: 1024,
      },
      new AbortController().signal,
    );
    const status = await manager.waitForExit(
      { sessionId: "acp-session", terminalId: created.terminalId },
      new AbortController().signal,
    );
    const output = await manager.output({
      sessionId: "acp-session",
      terminalId: created.terminalId,
    });
    await manager.release({
      sessionId: "acp-session",
      terminalId: created.terminalId,
    });

    assert.deepEqual(authorizations, [false]);
    assert.equal(status.exitCode, 0);
    assert.equal(output.output, "terminal-ready");
    assert.equal(output.truncated, false);
    assert.deepEqual(results, [{ exitCode: 0, outputTruncated: false }]);
  },
);

test(
  "runs a full-access ACP terminal without the project Seatbelt profile",
  { skip: process.platform !== "darwin" },
  async (context) => {
    const projectRoot = await realpath(
      await mkdtemp(path.join(tmpdir(), "radius-terminal-project-")),
    );
    const externalRoot = await realpath(
      await mkdtemp(path.join(tmpdir(), "radius-terminal-external-")),
    );
    const externalFile = path.join(externalRoot, "outside.txt");
    await writeFile(externalFile, "full-access-ready", "utf8");
    context.after(async () => {
      await rm(projectRoot, { force: true, recursive: true });
      await rm(externalRoot, { force: true, recursive: true });
    });
    const manager = new MacOsTerminalManager({
      fullAccess: true,
      projectRoots: [projectRoot],
      authorize: async () => "tool-call-full",
      onResult: () => undefined,
    });
    manager.bindSession("full-access-session");

    const created = await manager.create(
      {
        sessionId: "full-access-session",
        command: "/bin/cat",
        args: [externalFile],
        cwd: projectRoot,
      },
      new AbortController().signal,
    );
    const status = await manager.waitForExit(
      {
        sessionId: "full-access-session",
        terminalId: created.terminalId,
      },
      new AbortController().signal,
    );
    const output = await manager.output({
      sessionId: "full-access-session",
      terminalId: created.terminalId,
    });
    await manager.release({
      sessionId: "full-access-session",
      terminalId: created.terminalId,
    });

    assert.equal(status.exitCode, 0);
    assert.equal(output.output, "full-access-ready");
  },
);

test("rejects an ACP terminal bound to another session", async () => {
  const manager = new MacOsTerminalManager({
    projectRoots: [tmpdir()],
    authorize: async () => "tool-call",
    onResult: () => undefined,
  });
  manager.bindSession("expected");
  await assert.rejects(
    manager.create(
      { sessionId: "other", command: "/bin/pwd" },
      new AbortController().signal,
    ),
    /does not belong/,
  );
});
