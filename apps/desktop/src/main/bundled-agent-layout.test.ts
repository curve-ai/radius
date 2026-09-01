import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readEmbeddedAgentRelease } from "./bundled-agent-layout.js";

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

async function writeBlob(
  root: string,
  value: unknown,
): Promise<{
  digest: string;
  size: number;
}> {
  const bytes = jsonBytes(value);
  const digestHex = createHash("sha256").update(bytes).digest("hex");
  await writeFile(path.join(root, "blobs", "sha256", digestHex), bytes);
  return { digest: `sha256:${digestHex}`, size: bytes.byteLength };
}

async function withLayout(
  options: { configVersion?: string } = {},
): Promise<{ directory: string; layout: string; releaseVersion: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "radius-agent-oci-"));
  const layout = path.join(directory, "layout");
  await mkdir(path.join(layout, "blobs", "sha256"), { recursive: true });
  const releaseVersion = "0.0.5-radius.2";
  const reference = `radius.local/fx:${releaseVersion}`;
  const template = {
    schemaVersion: 1,
    agentId: "fx",
    providerId: "vercel-labs",
    displayName: "fx",
    releaseVersion,
    protocol: { kind: "acp-stdio", version: 1 },
    image: {
      reference,
      digest: `sha256:${"0".repeat(64)}`,
      platform: "linux/arm64",
      translation: "none",
    },
    process: {
      arguments: ["/usr/local/bin/agent", "acp"],
      user: "10000:10000",
      statePath: "/opt/data",
    },
    resources: {
      cpus: 2,
      memoryMb: 2048,
      rootfsMb: 256,
      stateMb: 1024,
      processLimit: 256,
      openFileLimit: 1024,
    },
    networkAllowlist: [],
    capabilities: [],
    authRequirements: [],
    models: [],
    defaultModelId: null,
  };
  const config = await writeBlob(layout, {
    config: {
      Labels: {
        "org.opencontainers.image.version":
          options.configVersion ?? releaseVersion,
        "ai.curve.radius.release-template.v1": Buffer.from(
          JSON.stringify(template),
        ).toString("base64"),
      },
    },
  });
  const manifest = await writeBlob(layout, {
    schemaVersion: 2,
    config,
    layers: [],
  });
  await writeFile(
    path.join(layout, "index.json"),
    JSON.stringify({
      schemaVersion: 2,
      manifests: [
        {
          ...manifest,
          annotations: { "io.containerd.image.name": reference },
        },
      ],
    }),
  );
  return { directory, layout, releaseVersion };
}

test("reads the release version and template committed by the OCI image", async () => {
  const fixture = await withLayout();
  try {
    const embedded = await readEmbeddedAgentRelease(fixture.layout);
    assert.equal(embedded.template.releaseVersion, fixture.releaseVersion);
    assert.equal(
      Reflect.get(embedded.template.image as object, "digest"),
      embedded.platformManifestDigest,
    );
  } finally {
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

test("rejects a release version that diverges from the OCI image", async () => {
  const fixture = await withLayout({ configVersion: "0.0.5" });
  try {
    await assert.rejects(
      readEmbeddedAgentRelease(fixture.layout),
      /BUNDLED_AGENT_RELEASE_METADATA_MISMATCH/,
    );
  } finally {
    await rm(fixture.directory, { force: true, recursive: true });
  }
});
