import assert from "node:assert/strict";
import { test } from "node:test";

import { AgentConfigSchema } from "@curve-ai/agent-contracts";
import { parseAgentReleaseDescriptor } from "@curve-ai/radius-runtime";

import {
  encodeReleaseTemplate,
  releaseTemplateLabels,
  releaseVersionFor,
  synthesiseReleaseTemplate,
  RELEASE_TEMPLATE_LABEL,
  VERSION_LABEL,
} from "./release-template.js";
import { selectManifest } from "./importable.js";

const config = AgentConfigSchema.parse({
  schemaVersion: 1,
  agent: "agent_example1",
  version: "1.2.3",
  name: "Example",
  runtime: { kind: "typescript", entrypoint: "agent.ts", node: "22" },
  capabilities: [{ key: "workspace.files", operations: ["read", "write"] }],
  networkAllowlist: ["example.test"],
});

const input = {
  config,
  buildDigest: "a".repeat(64),
  imageReference: "radius.local/dev/example:aaaaaaaaaaaaaaaa",
  platform: "linux/arm64" as const,
  processArguments: ["node", "/opt/agent/agent.mjs"],
  imageSizeMb: 300,
};

test("the synthesised template validates as a release descriptor", () => {
  const descriptor = parseAgentReleaseDescriptor(
    synthesiseReleaseTemplate(input),
  );
  assert.equal(descriptor.agentId, "agent_example1");
  assert.equal(descriptor.providerId, "local");
  assert.equal(descriptor.releaseVersion, `1.2.3+${"a".repeat(16)}`);
  assert.deepEqual(descriptor.capabilities, [
    "workspace.files.read",
    "workspace.files.write",
  ]);
  assert.equal(descriptor.resources.rootfsMb, 428, "measured plus headroom");
});

test("a config without an agent id is refused, not silently defaulted", () => {
  const anonymous = AgentConfigSchema.parse({
    schemaVersion: 1,
    name: "Example",
    runtime: { kind: "typescript", entrypoint: "agent.ts", node: "22" },
  });
  assert.throws(
    () => synthesiseReleaseTemplate({ ...input, config: anonymous }),
    /radius init/,
  );
});

test("the template is identical for identical input", () => {
  // CUR-59's reproducibility rule: nothing in the template may vary between
  // builds of the same input, or the version drifts from the bytes.
  assert.equal(
    encodeReleaseTemplate(synthesiseReleaseTemplate(input)),
    encodeReleaseTemplate(synthesiseReleaseTemplate(input)),
  );
});

test("labels carry the version the importer cross-checks", () => {
  const template = synthesiseReleaseTemplate(input);
  const labels = releaseTemplateLabels(template);
  // The importer rejects a layout whose version label and template disagree.
  assert.equal(labels[VERSION_LABEL], template.releaseVersion);
  const decoded = JSON.parse(
    Buffer.from(labels[RELEASE_TEMPLATE_LABEL]!, "base64").toString("utf8"),
  ) as { releaseVersion: string };
  assert.equal(decoded.releaseVersion, labels[VERSION_LABEL]);
});

test("releaseVersion ties the semver to the build digest", () => {
  assert.equal(releaseVersionFor("0.0.0", "b".repeat(64)), `0.0.0+${"b".repeat(16)}`);
});

test("a manifest is selected by platform, not by position", () => {
  const amd = { digest: "sha256:1", platform: { os: "linux", architecture: "amd64" } };
  const arm = { digest: "sha256:2", platform: { os: "linux", architecture: "arm64" } };
  // amd64 deliberately first: taking manifests[0] would pick the wrong one.
  assert.equal(selectManifest([amd, arm], "linux/arm64").digest, "sha256:2");
  assert.equal(selectManifest([amd, arm], "linux/amd64").digest, "sha256:1");
});

test("an index with no manifest for the platform fails loudly", () => {
  const amd = { digest: "sha256:1", platform: { os: "linux", architecture: "amd64" } };
  assert.throws(() => selectManifest([amd], "linux/arm64"), /no linux\/arm64 manifest/);
});

test("a single unlabelled manifest is accepted, as buildx emits it", () => {
  assert.equal(selectManifest([{ digest: "sha256:9" }], "linux/arm64").digest, "sha256:9");
});
