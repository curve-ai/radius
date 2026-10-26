import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentBuildReceiptSchema } from "@curve-ai/agent-contracts";
import { parseAgentReleaseDescriptor } from "@curve-ai/radius-runtime";
import buildCommand from "../packages/cli-next/src/commands/build/run.js";
import { buildContext } from "../packages/cli-next/src/context.js";

// Build real images through the new CLI with Windows host facts. This smoke
// needs Docker; running a Windows VM remains a separate WHP-host check.
const root = await mkdtemp(join(tmpdir(), "radius-windows-pipeline-"));
try {
  for (const kind of ["typescript", "harness"] as const) {
    const project = join(root, kind);
    await mkdir(project);
    let runtime: object;
    if (kind === "typescript") {
      await writeFile(
        join(project, "agent.ts"),
        "console.log('Windows pipeline smoke');\n",
      );
      runtime = { kind, entrypoint: "agent.ts", node: "22" };
    } else {
      const contents = join(project, "archive");
      await mkdir(contents);
      await writeFile(
        join(contents, "agent"),
        "#!/bin/sh\nprintf 'smoke harness\\n'\n",
        { mode: 0o755 },
      );
      execFileSync("tar", [
        "-czf",
        join(project, "harness.tar.gz"),
        "-C",
        contents,
        ".",
      ]);
      runtime = {
        kind,
        distribution: {
          kind: "binary",
          cmd: "./wrong-platform",
          platforms: {
            "linux/amd64": { archive: "harness.tar.gz", cmd: "./agent" },
          },
        },
      };
    }
    await writeFile(
      join(project, "radius.json"),
      JSON.stringify({
        schemaVersion: 1,
        agent: `agent_smoke_${kind}`,
        name: `Windows ${kind}`,
        runtime,
      }),
    );
    const context = buildContext([], process);
    const windowsContext = {
      ...context,
      cwd: project,
      process: { ...context.process, platform: "win32" as const, arch: "x64" },
    };
    await buildCommand.call(windowsContext, {
      "skip-verify": true,
      json: false,
    });
    assert.equal(context.failure(), null, `${kind} build failed`);
    const latest = JSON.parse(
      await readFile(join(project, ".radius", "builds", "latest.json"), "utf8"),
    );
    const receipt = AgentBuildReceiptSchema.parse(
      JSON.parse(
        await readFile(
          join(
            project,
            ".radius",
            "builds",
            latest.buildDigest,
            "receipt.json",
          ),
          "utf8",
        ),
      ),
    );
    assert.equal(receipt.verification.platform, "linux/amd64");
    assert.equal(receipt.verification.verified, false);
    assert.equal(receipt.verification.skippedBecause, "--skip-verify");
    const layout = join(project, receipt.layoutPath);
    const blob = async (digest: string) =>
      JSON.parse(
        await readFile(
          join(layout, "blobs", "sha256", digest.slice(7)),
          "utf8",
        ),
      );
    const index = JSON.parse(
      await readFile(join(layout, "index.json"), "utf8"),
    );
    const manifest = await blob(index.manifests[0].digest);
    const config = await blob(manifest.config.digest);
    assert.equal(config.os, "linux");
    assert.equal(config.architecture, "amd64");
    const release = parseAgentReleaseDescriptor(
      JSON.parse(
        Buffer.from(
          config.config.Labels["ai.curve.radius.release-template.v1"],
          "base64",
        ).toString(),
      ),
    );
    assert.equal(release.image.platform, "linux/amd64");
    assert.equal(release.image.translation, "native");
    assert.equal(release.releaseVersion, receipt.release?.version);
    if (kind === "harness")
      assert.equal(release.process.arguments[0], "/opt/agent/agent");
    console.log(`Windows ${kind} image, release and CLI receipt verified`);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
