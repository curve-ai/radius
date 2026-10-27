import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  pushTypeScriptOciImage,
  type OciCommandRunner,
  type TypeScriptOciBuildResult,
} from "./index.js";
import { runOciCommand } from "./push.js";

test("command results include the complete bounded output after the child exits", async () => {
  const result = await runOciCommand({
    command: process.execPath,
    args: [
      "-e",
      "process.stdout.write('x'.repeat(262144)+'STDOUT_DONE'); process.stderr.write('y'.repeat(262144)+'STDERR_DONE')",
    ],
    cwd: tmpdir(),
  });
  assert.equal(result.stdout.length, 65_536);
  assert.equal(result.stderr.length, 65_536);
  assert.ok(result.stdout.endsWith("STDOUT_DONE"));
  assert.ok(result.stderr.endsWith("STDERR_DONE"));
});

test("a child that closes stdin reports its failure without an uncaught broken pipe", async () => {
  await assert.rejects(
    () =>
      runOciCommand({
        command: process.execPath,
        args: [
          "-e",
          "require('node:fs').closeSync(0); process.stderr.write('expected-child-failure'); setTimeout(()=>process.exit(7),5)",
        ],
        cwd: tmpdir(),
        stdin: "x".repeat(1_048_576),
      }),
    /failed with 7: expected-child-failure/,
  );
});

test("uses a temporary Docker config and never places the password in argv", async () => {
  const root = await mkdtemp(join(tmpdir(), "radius-oci-push-"));
  const contextPath = join(root, "context");
  const layoutPath = join(root, "oci-layout");
  await Promise.all([mkdir(contextPath), mkdir(layoutPath)]);
  await writeFile(join(contextPath, "Containerfile"), "FROM scratch\n");
  const calls: Parameters<OciCommandRunner>[0][] = [];
  const runner: OciCommandRunner = async (options) => {
    calls.push(options);
    if (options.args.includes("inspect")) {
      return {
        stdout: `Name: registry.example/acme/agent:test\nDigest: sha256:${"d".repeat(64)}\n`,
        stderr: "",
      };
    }
    return { stdout: "", stderr: "" };
  };
  const build = {
    buildDigest: "a".repeat(64),
    imageReference: "radius.local/dev/agent:test",
    imageDigest: `sha256:${"b".repeat(64)}`,
    layoutPath,
    contextPath,
    manifest: {} as TypeScriptOciBuildResult["manifest"],
    bundleSha256: "c".repeat(64),
    releaseVersion: `0.0.0+${"a".repeat(16)}`,
    indexPath: `${layoutPath}/../index.json`,
  } satisfies TypeScriptOciBuildResult;

  const digest = await pushTypeScriptOciImage({
    build,
    imageReference: "registry.example/acme/agent:test",
    credentials: {
      registry: "registry.example",
      username: "upload",
      password: "top-secret",
    },
    commandRunner: runner,
  });

  assert.equal(digest, `sha256:${"d".repeat(64)}`);
  const login = calls.find((call) => call.args.includes("login"));
  assert.equal(login?.stdin, "top-secret\n");
  assert.equal(
    calls.some((call) => call.args.includes("top-secret")),
    false,
  );
  assert.ok(calls.some((call) => call.args.includes("load")));
  assert.ok(calls.some((call) => call.args.includes("tag")));
  assert.ok(calls.some((call) => call.args.includes("push")));
  assert.equal(
    calls.some((call) => call.args[0] === "buildx" && call.args[1] === "build"),
    false,
  );
  assert.ok(
    calls
      .filter((call) => call.command === "docker")
      .every((call) => call.env?.DOCKER_CONFIG),
  );
});
