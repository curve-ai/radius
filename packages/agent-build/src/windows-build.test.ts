import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { AgentConfigSchema } from "@curve-ai/agent-contracts";
import { parseAgentReleaseDescriptor } from "@curve-ai/radius-runtime";
import { buildHarnessOciLayout } from "./harness-oci.js";
import { buildTypeScriptOciLayout } from "./oci.js";
import { runOciCommand, type OciCommandRunner } from "./push.js";

/** A Docker save fixture, so the Windows path also proves its OCI conversion. */
function dockerFixture(): OciCommandRunner {
  let labels: Record<string, string> = {};
  let architecture = "";
  let reference = "";
  return async (input) => {
    if (input.command !== "docker") return runOciCommand(input);
    const args = input.args;
    if (args[0] === "buildx") {
      architecture = args[args.indexOf("--platform") + 1]!.split("/")[1]!;
      reference = args[args.indexOf("--tag") + 1]!;
      labels = Object.fromEntries(
        args.flatMap((arg, i) => {
          if (arg !== "--label") return [];
          const value = args[i + 1]!;
          const split = value.indexOf("=");
          return [[value.slice(0, split), value.slice(split + 1)]];
        }),
      );
      if (args.includes("--load")) return { stdout: "", stderr: "" };
    }
    const destination =
      args[0] === "save"
        ? args[args.indexOf("--output") + 1]!
        : args[args.indexOf("--output") + 1]!.replace(/^type=oci,dest=/, "");
    const scratch = await mkdtemp(join(tmpdir(), "radius-docker-save-"));
    try {
      await writeFile(
        join(scratch, "config.json"),
        JSON.stringify({
          architecture,
          os: "linux",
          config: { Labels: labels },
        }),
      );
      await writeFile(join(scratch, "layer.tar"), "fixture image layer");
      await writeFile(
        join(scratch, "manifest.json"),
        JSON.stringify([
          {
            Config: "config.json",
            RepoTags: [reference],
            Layers: ["layer.tar"],
          },
        ]),
      );
      await runOciCommand({
        command: "tar",
        args: ["-cf", destination, "-C", scratch, "."],
        cwd: scratch,
      });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
    return { stdout: "", stderr: "" };
  };
}

async function shippedImage(layout: string) {
  const index = JSON.parse(await readFile(join(layout, "index.json"), "utf8"));
  const blob = (digest: string) =>
    readFile(join(layout, "blobs", "sha256", digest.slice(7)), "utf8");
  const manifest = JSON.parse(await blob(index.manifests[0].digest));
  const config = JSON.parse(await blob(manifest.config.digest));
  const template = JSON.parse(
    Buffer.from(
      config.config.Labels["ai.curve.radius.release-template.v1"],
      "base64",
    ).toString(),
  );
  const release = parseAgentReleaseDescriptor(template);
  const layerBytes = await readFile(
    join(layout, "blobs", "sha256", manifest.layers[0].digest.slice(7)),
  );
  assert.equal(
    manifest.layers[0].mediaType,
    "application/vnd.oci.image.layer.v1.tar+gzip",
  );
  assert.equal(gunzipSync(layerBytes).toString(), "fixture image layer");
  assert.equal(
    manifest.layers[0].digest,
    `sha256:${createHash("sha256").update(layerBytes).digest("hex")}`,
  );
  return { release, config, index };
}

test("TypeScript builds keep image architecture, release metadata and identity aligned", async () => {
  const root = await mkdtemp(join(tmpdir(), "radius-windows-build-"));
  try {
    await writeFile(join(root, "agent.ts"), "console.log('agent');");
    const config = AgentConfigSchema.parse({
      agent: "agent_windows01",
      name: "Windows build",
      runtime: { kind: "typescript", entrypoint: "agent.ts" },
    });
    const digests = new Set<string>();
    for (const platform of ["linux/arm64", "linux/amd64"] as const) {
      const result = await buildTypeScriptOciLayout({
        root,
        config,
        platform,
        commandRunner: dockerFixture(),
      });
      digests.add(result.buildDigest);
      const { release, config: image } = await shippedImage(result.layoutPath);
      assert.equal(`${image.os}/${image.architecture}`, platform);
      assert.equal(release.image.platform, platform);
      assert.equal(
        release.image.translation,
        platform === "linux/amd64" ? "native" : "none",
      );
      assert.equal(release.releaseVersion, result.releaseVersion);
    }
    assert.equal(
      digests.size,
      2,
      "architectures must not overwrite one immutable build",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const platform of ["linux/arm64", "linux/amd64"] as const) {
  test(`harness builds select the ${platform} archive and entrypoint`, async () => {
    const root = await mkdtemp(join(tmpdir(), "radius-windows-harness-"));
    try {
      await writeFile(join(root, "arm.tar"), "arm harness");
      await writeFile(join(root, "amd.tar"), "amd harness");
      const config = AgentConfigSchema.parse({
        agent: "agent_harness01",
        name: "Harness",
        runtime: {
          kind: "harness",
          distribution: {
            kind: "binary",
            cmd: "./default",
            platforms: {
              "linux/arm64": { archive: "arm.tar", cmd: "./arm-agent" },
              "linux/amd64": { archive: "amd.tar", cmd: "./amd-agent" },
            },
          },
        },
      });
      const result = await buildHarnessOciLayout({
        root,
        config,
        platform,
        commandRunner: dockerFixture(),
      });
      const { release, config: image } = await shippedImage(result.layoutPath);
      assert.equal(`${image.os}/${image.architecture}`, platform);
      assert.equal(release.image.platform, platform);
      const architecture = platform === "linux/amd64" ? "amd" : "arm";
      assert.equal(
        await readFile(join(result.contextPath, "harness-archive"), "utf8"),
        `${architecture} harness`,
      );
      assert.equal(
        release.process.arguments[0],
        `/opt/agent/${architecture}-agent`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
