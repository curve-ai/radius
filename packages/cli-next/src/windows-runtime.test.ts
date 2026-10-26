import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  AgentBuildReceiptSchema,
  AgentConfigSchema,
} from "@curve-ai/agent-contracts";
import { createAgentManifest, hostImagePlatform } from "@curve-ai/build";
import { resolveRuntimeAssets } from "./desktop.js";
import { readShippedTemplate } from "./verify.js";

async function file(path: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "fixture");
  await chmod(path, 0o755);
}

for (const installed of [true, false]) {
  test(`the Windows CLI finds a complete ${installed ? "installed" : "checkout"} runtime`, async () => {
    const root = await mkdtemp(join(tmpdir(), "radius-win-assets-"));
    try {
      const base = installed
        ? join(root, "app", "resources", "runtime")
        : join(root, "apps", "runtime-host-windows", ".build");
      const host = join(
        base,
        installed ? "windows-x64" : "release",
        "radius-runtime-host.exe",
      );
      const kernel = installed
        ? join(base, "vmlinux-x64")
        : join(base, "runtime-assets", "vmlinux-x64");
      await file(host);
      await file(kernel);
      const input = {
        projectRoot: root,
        env: installed ? { RADIUS_APP_PATH: join(root, "app") } : {},
        platform: "win32",
        arch: "x64",
      };
      await assert.rejects(
        () => resolveRuntimeAssets(input),
        /Could not find the Windows/,
      );
      await file(join(dirname(host), "openvmm.exe"));
      const found = await resolveRuntimeAssets(input);
      assert.equal(found.runtimeHostPath, host);
      assert.equal(found.kernelPath, kernel);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("Windows receipts preserve the new CLI's verification evidence", () => {
  const config = AgentConfigSchema.parse({
    agent: "agent_windows01",
    name: "Windows",
    runtime: { kind: "typescript", entrypoint: "agent.ts" },
  });
  const receipt = AgentBuildReceiptSchema.parse({
    schemaVersion: 1,
    buildDigest: "a".repeat(64),
    imageReference: "radius.local/dev/windows:1",
    sourceManifestDigest: `sha256:${"b".repeat(64)}`,
    bundleSha256: "c".repeat(64),
    layoutPath: "build/oci-layout",
    contextPath: "build/context",
    manifest: createAgentManifest(config),
    verifiedAt: new Date().toISOString(),
    verification: {
      kind: "microvm-acp",
      platform: hostImagePlatform("win32", "x64"),
      verified: false,
      skippedBecause: "--skip-verify",
    },
  });
  assert.equal(receipt.verification.platform, "linux/amd64");
  assert.equal(receipt.verification.verified, false);
  assert.equal(receipt.verification.skippedBecause, "--skip-verify");
});

test("verification reads the requested architecture, even when it is listed second", async () => {
  const root = await mkdtemp(join(tmpdir(), "radius-win-template-"));
  try {
    const manifests = [];
    await mkdir(join(root, "blobs", "sha256"), { recursive: true });
    for (const architecture of ["arm64", "amd64"]) {
      const template = { image: { platform: `linux/${architecture}` } };
      const configDigest = `${architecture}-config`;
      const manifestDigest = `${architecture}-manifest`;
      await writeFile(
        join(root, "blobs", "sha256", configDigest),
        JSON.stringify({
          config: {
            Labels: {
              "ai.curve.radius.release-template.v1": Buffer.from(
                JSON.stringify(template),
              ).toString("base64"),
            },
          },
        }),
      );
      await writeFile(
        join(root, "blobs", "sha256", manifestDigest),
        JSON.stringify({ config: { digest: `sha256:${configDigest}` } }),
      );
      manifests.push({
        digest: `sha256:${manifestDigest}`,
        platform: { os: "linux", architecture },
      });
    }
    await writeFile(join(root, "index.json"), JSON.stringify({ manifests }));
    const template = await readShippedTemplate(root, "linux/amd64");
    assert.deepEqual(template.image, { platform: "linux/amd64" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
