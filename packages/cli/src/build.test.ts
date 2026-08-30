import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAgentManifest } from "@curve-ai/build";

import { buildAgent, loadBuildReceipt } from "./build.js";

test("writes a microVM-verified immutable build receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "radius-build-receipt-"));
  const buildDigest = "a".repeat(64);
  await writeFile(
    join(root, "radius.config.json"),
    JSON.stringify({
      schemaVersion: 1,
      agent: "agent_example1",
      name: "Built agent",
      runtime: {
        kind: "typescript",
        entrypoint: "radius/agent.ts",
        node: "22",
      },
    }),
  );
  const outputRoot = join(root, ".radius", "builds", buildDigest);
  const layoutPath = join(outputRoot, "oci-layout");
  const contextPath = join(outputRoot, "context");
  await Promise.all([
    mkdir(layoutPath, { recursive: true }),
    mkdir(contextPath, { recursive: true }),
  ]);
  let verified = false;

  const receipt = await buildAgent({
    root,
    io: { out: () => undefined, error: () => undefined },
    buildOci: async ({ config }) => ({
      buildDigest,
      imageReference: "radius.local/dev/built-agent:test",
      imageDigest: `sha256:${"b".repeat(64)}`,
      layoutPath,
      contextPath,
      manifest: createAgentManifest(config),
      bundleSha256: "c".repeat(64),
    }),
    verifyBuild: async () => {
      verified = true;
    },
  });

  assert.equal(verified, true);
  assert.equal(receipt.buildDigest, buildDigest);
  const loaded = await loadBuildReceipt(root);
  assert.equal(loaded.receipt.buildDigest, buildDigest);
  assert.equal(loaded.build.layoutPath, layoutPath);
  const latest = JSON.parse(
    await readFile(join(root, ".radius", "builds", "latest.json"), "utf8"),
  ) as { buildDigest: string };
  assert.equal(latest.buildDigest, buildDigest);
});
