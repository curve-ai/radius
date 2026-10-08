import assert from "node:assert/strict";
import test from "node:test";

import { hostImageMismatch } from "./host-platform.js";
import { parseAgentReleaseDescriptor } from "./release.js";

const arm64 = {
  reference: "radius.local/dev/agent:1",
  digest: `sha256:${"a".repeat(64)}`,
  platform: "linux/arm64",
  translation: "none",
} as const;
const amd64Rosetta = {
  ...arm64,
  platform: "linux/amd64",
  translation: "rosetta",
} as const;
const amd64Native = {
  ...arm64,
  platform: "linux/amd64",
  translation: "native",
} as const;

test("keeps the macOS answers on a Mac", () => {
  assert.equal(hostImageMismatch(arm64, "darwin", "arm64"), null);
  assert.equal(hostImageMismatch(amd64Rosetta, "darwin", "arm64"), null);
  assert.match(
    hostImageMismatch(amd64Native, "darwin", "arm64") ?? "",
    /only for Windows x64/,
  );
});

test("runs only native linux/amd64 images on Windows x64", () => {
  assert.equal(hostImageMismatch(amd64Native, "win32", "x64"), null);
  assert.match(
    hostImageMismatch(arm64, "win32", "x64") ?? "",
    /needs linux\/amd64/,
  );
  assert.match(
    hostImageMismatch(amd64Rosetta, "win32", "x64") ?? "",
    /translation "native"/,
  );
  assert.match(hostImageMismatch(amd64Native, "win32", "arm64") ?? "", /x64/);
});

test("release cards accept native only for linux/amd64", () => {
  const release = {
    schemaVersion: 1,
    agentId: "example-agent",
    providerId: "example-provider",
    displayName: "Example Agent",
    releaseVersion: "1.0.0",
    protocol: { kind: "acp-stdio", version: 1 },
    image: amd64Native,
    process: {
      arguments: ["/agent/start"],
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
    networkAllowlist: [],
    capabilities: [],
  };
  assert.equal(
    parseAgentReleaseDescriptor(release).image.translation,
    "native",
  );
  assert.throws(() =>
    parseAgentReleaseDescriptor({
      ...release,
      image: { ...amd64Native, platform: "linux/arm64" },
    }),
  );
});
