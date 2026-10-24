import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AgentConfigSchema,
  type AgentConfigInput,
} from "@curve-ai/agent-contracts";

import {
  estimateHarnessImageMb,
  renderHarnessContainerfile,
} from "./harness-oci.js";

function harnessConfig(overrides: Record<string, unknown> = {}) {
  const input: AgentConfigInput = {
    agent: "agent_harness01",
    name: "Harness Agent",
    runtime: {
      kind: "harness",
      registryId: "opencode",
      distribution: {
        kind: "binary",
        cmd: "./opencode",
        args: ["acp"],
        platforms: {
          "linux/arm64": {
            archive: "https://example.invalid/opencode-linux-arm64.tar.gz",
            sha256: "a".repeat(64),
          },
          "windows/amd64": {
            archive: "https://example.invalid/opencode-windows-x64.zip",
            sha256: "b".repeat(64),
            cmd: "./opencode.exe",
          },
        },
      },
      ...overrides,
    },
  } as AgentConfigInput;
  const parsed = AgentConfigSchema.parse(input);
  assert.equal(parsed.runtime.kind, "harness");
  return parsed.runtime as Extract<typeof parsed.runtime, { kind: "harness" }>;
}

function render(overrides: Record<string, unknown> = {}, hasTree = true) {
  const runtime = harnessConfig(overrides);
  return renderHarnessContainerfile({
    runtime,
    launch: {
      processArguments: ["/opt/agent/opencode", "acp"],
      entrypoint: ["/opt/agent/opencode", "acp"],
    },
    hasTree,
  });
}

test("a binary-only harness ships nothing but the harness", () => {
  const containerfile = render({}, false);
  assert.match(containerfile, /^FROM debian:bookworm-slim@sha256:/m);
  assert.doesNotMatch(containerfile, /COPY --from=bun/);
  assert.doesNotMatch(containerfile, /COPY --chown=10000:10000 tree\//);
  assert.doesNotMatch(containerfile, /uv sync/);
  assert.match(containerfile, /ENTRYPOINT \["\/opt\/agent\/opencode", "acp"\]/);
});

test("the entrypoint is the harness command, so ACP comes from the harness", () => {
  // The whole point of the harness kind: the project never implements ACP, so
  // nothing in the image may run the project's own code as the entrypoint.
  const containerfile = render();
  const entrypoint = containerfile
    .split("\n")
    .find((line) => line.startsWith("ENTRYPOINT"));
  assert.equal(entrypoint, 'ENTRYPOINT ["/opt/agent/opencode", "acp"]');
});

test("declaring a python toolchain switches the base and installs from the lock", () => {
  const containerfile = render({
    include: ["src/", "pyproject.toml", "uv.lock"],
    toolchains: [{ kind: "python", version: "3.12", lockfile: "uv.lock" }],
  });
  assert.match(containerfile, /^FROM ghcr\.io\/astral-sh\/uv:python3\.12/m);
  assert.match(containerfile, /uv sync --frozen --no-dev/);
  // Never from a range: a floating install makes buildDigest drift.
  assert.doesNotMatch(containerfile, /uv (pip )?install [^-]/);
});

test("a node toolchain copies bun in and answers to the node shebang", () => {
  const containerfile = render({
    include: [".opencode/"],
    toolchains: [{ kind: "node", version: "22", lockfile: ".opencode/bun.lock" }],
  });
  assert.match(containerfile, /COPY --from=bun \/usr\/local\/bin\/bun/);
  assert.match(containerfile, /ln -sf \/usr\/local\/bin\/bun \/usr\/local\/bin\/node/);
  assert.match(containerfile, /bun install --frozen-lockfile --production/);
  // Installed where the lockfile lives, not at the config root: opencode keeps
  // its plugin dependencies beside .opencode/bun.lock.
  assert.match(containerfile, /WORKDIR \/opt\/data\/\.opencode/);
});

test("the tree is staged at the config root, and HOME points there", () => {
  const containerfile = render({
    include: [".opencode/"],
    configRoot: "/runtime",
  });
  assert.match(containerfile, /COPY --chown=10000:10000 tree\/ \/runtime\//);
  assert.match(containerfile, /^ENV HOME=\/runtime$/m);
  assert.match(containerfile, /^WORKDIR \/runtime$/m);
});

test("the archive is extracted whole and the command is proved present", () => {
  const containerfile = render();
  // A harness may ship assets beside its executable; copying one file loses them.
  assert.match(containerfile, /tar -xf \/tmp\/harness-archive -C \/opt\/agent/);
  assert.match(containerfile, /unzip -q \/tmp\/harness-archive -d \/opt\/agent/);
  assert.match(
    containerfile,
    /test -x \/opt\/agent\/opencode \|\| \(echo "harness archive does not contain/,
  );
});

test("the image never runs as root", () => {
  const containerfile = render({
    include: ["uv.lock"],
    toolchains: [{ kind: "python", version: "3.12", lockfile: "uv.lock" }],
  });
  const lines = containerfile.split("\n");
  const firstInstall = lines.findIndex((line) => line.includes("uv sync"));
  const userBefore = lines
    .slice(0, firstInstall)
    .some((line) => line.trim() === "USER 10000:10000");
  assert.ok(userBefore, "dependencies must install as the agent user");
  assert.equal(
    lines.filter((line) => line.startsWith("USER ")).at(-1),
    "USER 10000:10000",
  );
});

test("a toolchain whose lockfile is not shipped is refused by the schema", () => {
  assert.throws(
    () =>
      harnessConfig({
        include: [".opencode/"],
        toolchains: [{ kind: "python", version: "3.12", lockfile: "uv.lock" }],
      }),
    /uv\.lock is not covered by runtime\.include/,
  );
});

test("a directory in include covers a lockfile inside it", () => {
  const runtime = harnessConfig({
    include: [".opencode/"],
    toolchains: [
      { kind: "node", version: "22", lockfile: ".opencode/bun.lock" },
    ],
  });
  assert.equal(runtime.toolchains.length, 1);
});

test("one toolchain per kind", () => {
  assert.throws(
    () =>
      harnessConfig({
        include: ["uv.lock", "other.lock"],
        toolchains: [
          { kind: "python", version: "3.12", lockfile: "uv.lock" },
          { kind: "python", version: "3.13", lockfile: "other.lock" },
        ],
      }),
    /at most once/,
  );
});

test("the size estimate grows with the harness, the tree and each toolchain", () => {
  const bare = estimateHarnessImageMb({
    harnessBytes: 0,
    treeBytes: 0,
    toolchains: [],
  });
  const withHarness = estimateHarnessImageMb({
    harnessBytes: 140_000_000,
    treeBytes: 0,
    toolchains: [],
  });
  const withBoth = estimateHarnessImageMb({
    harnessBytes: 140_000_000,
    treeBytes: 2_000_000,
    toolchains: [
      { kind: "python", version: "3.12", lockfile: "uv.lock" },
      { kind: "node", version: "22", lockfile: "bun.lock" },
    ],
  });
  assert.ok(withHarness > bare, "a 140MB binary must raise the estimate");
  assert.ok(withBoth > withHarness, "toolchains must raise it further");
  // The pinned-base constant is why a bundle-only estimate undershot a harness.
  assert.ok(bare >= 100, `a bare harness image is not tiny, got ${bare}MB`);
});

test("a bare harness estimate covers a real opencode rootfs", () => {
  // Measured: the 78MB linux/arm64 opencode archive produces a 716MB rootfs
  // with no project tree and no toolchains. A 4x expansion claimed 414MB and
  // the post-build check rejected the layout.
  const estimate = estimateHarnessImageMb({
    harnessBytes: 78_500_000,
    treeBytes: 0,
    toolchains: [],
  });
  assert.ok(
    estimate >= 716,
    `must cover the measured 716MB rootfs, claimed ${estimate}MB`,
  );
});

test("a harness with no linux/arm64 build cannot be packaged", async () => {
  const { buildHarnessOciLayout } = await import("./harness-oci.js");
  await assert.rejects(
    () =>
      buildHarnessOciLayout({
        root: process.cwd(),
        config: {
          agent: "agent_harness01",
          name: "Windows Only",
          runtime: {
            kind: "harness",
            distribution: {
              kind: "binary",
              cmd: "./agent.exe",
              platforms: {
                "windows/amd64": {
                  archive: "https://example.invalid/a.zip",
                  sha256: "c".repeat(64),
                },
              },
            },
          },
        } as AgentConfigInput,
        outputRoot: `${process.cwd()}/.radius-test-out`,
      }),
    /publishes no linux\/arm64 build/,
  );
});
