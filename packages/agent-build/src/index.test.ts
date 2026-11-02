import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalJson,
  createAgentManifest,
  defineConfig,
  recognisedDockerFailure,
} from "./index.js";

test("creates an ACP manifest from normalized config", () => {
  const config = defineConfig({
    agent: "agent_example1",
    name: "Example agent",
    runtime: { kind: "typescript", entrypoint: "radius/agent.ts" },
  });
  const manifest = createAgentManifest(config);
  assert.deepEqual(manifest.protocol, { kind: "acp-stdio", version: 1 });
  assert.equal(manifest.agent, "agent_example1");
  assert.equal(manifest.minimumDesktopVersion, "0.0.1");
});

test("canonical JSON sorts object keys without reordering arrays", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: 2, b: [3, 1] } }),
    '{\n  "a": {\n    "b": [\n      3,\n      1\n    ],\n    "y": 2\n  },\n  "z": 1\n}\n',
  );
});

test("a build for the other architecture without emulation says how to turn it on", () => {
  const failure = recognisedDockerFailure(
    "#7 [2/5] RUN groupadd --gid 10000 radius\n#7 0.112 exec /bin/sh: exec format error\nERROR: process did not complete successfully",
  );
  assert.equal(failure?.name, "BuildError");
  assert.match(failure!.message, /other CPU architecture/);
  assert.match(failure!.nextAction ?? "", /Rosetta/);
  assert.match(failure!.nextAction ?? "", /tonistiigi\/binfmt/);
});

test("a docker driver that cannot export OCI is still explained", () => {
  assert.match(
    recognisedDockerFailure(
      "ERROR: OCI exporter is not supported for the docker driver.",
    )?.message ?? "",
    /cannot export an OCI layout/,
  );
});

test("an unrecognised docker failure is left to the caller", () => {
  assert.equal(recognisedDockerFailure("no space left on device"), null);
});
