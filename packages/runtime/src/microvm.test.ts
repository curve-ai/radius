import assert from "node:assert/strict";
import test from "node:test";

import { microvmRuntimeArguments, runtimeProcessFailure } from "./microvm.js";
import { parseAgentReleaseDescriptor } from "./release.js";

test("builds a shell-free digest-pinned microVM command", () => {
  const release = parseAgentReleaseDescriptor({
    schemaVersion: 1,
    agentId: "hermes",
    providerId: "provider",
    displayName: "Hermes",
    releaseVersion: "1",
    protocol: { kind: "acp-stdio", version: 1 },
    image: {
      reference: "docker.io/example/hermes",
      digest: `sha256:${"b".repeat(64)}`,
      platform: "linux/amd64",
      translation: "rosetta",
    },
    process: {
      arguments: ["/opt/hermes/hermes-acp"],
      user: "10000:10000",
      statePath: "/opt/data",
    },
    resources: {
      cpus: 2,
      memoryMb: 4096,
      rootfsMb: 2048,
      stateMb: 5120,
      processLimit: 256,
      openFileLimit: 1024,
    },
    networkAllowlist: ["chatgpt.com"],
    capabilities: [],
  });
  const args = microvmRuntimeArguments({
    release,
    containerId: "test-container",
    paths: {
      runtimeHostPath: "/runtime-host",
      kernelPath: "/kernel",
      runtimeRoot: "/runtime",
      developerStateSharePath: "/state",
      developerStateShareUser: "501:20",
    },
  });

  assert.deepEqual(args.slice(0, 5), [
    "run",
    "--image",
    `docker.io/example/hermes@sha256:${"b".repeat(64)}`,
    "--kernel",
    "/kernel",
  ]);
  assert.ok(args.includes("--rosetta"));
  assert.ok(args.includes("--developer-state-share"));
  assert.equal(args[args.indexOf("--process-limit") + 1], "256");
  assert.equal(args[args.indexOf("--open-file-limit") + 1], "1024");
  assert.equal(args.at(-1), "/opt/hermes/hermes-acp");
});

test("preserves runtime process diagnostics when ACP closes", () => {
  const error = runtimeProcessFailure(
    new Error("ACP connection closed"),
    { code: 70, signal: null },
    '{"code":"RUNTIME_ERROR","message":"Local agent image is not loaded"}\n',
  );

  assert.equal(
    error.message,
    "Agent runtime exited with code 70: Local agent image is not loaded",
  );
});
