import assert from "node:assert/strict";
import test from "node:test";

import { renderPythonContainerfile } from "./python-oci.js";

test("renders a pinned non-root Python and uv image", () => {
  const containerfile = renderPythonContainerfile("radius_agent.agent");
  assert.match(
    containerfile,
    /^FROM ghcr\.io\/astral-sh\/uv:0\.8\.22@sha256:[a-f0-9]{64} AS uv/,
  );
  assert.match(containerfile, /FROM python:3\.12\.11-slim-bookworm@sha256:[a-f0-9]{64}/);
  assert.match(containerfile, /USER 10000:10000/);
  assert.match(containerfile, /ENTRYPOINT \["python", "-m", "radius_agent\.agent"\]/);
  assert.doesNotMatch(containerfile, /latest/);
});

test("rejects an invalid Python module before rendering", () => {
  assert.throws(() => renderPythonContainerfile("agent; rm"), /module is invalid/);
});

test("the Python estimate accounts for dependencies, not just file size", async () => {
  const { estimatePythonImageMb, countLockedPackages } = await import(
    "./python-oci.js"
  );
  // Dependencies install inside the image, so two text files told us nothing:
  // a torch-sized project claimed a few hundred MB and failed its own check.
  const lockfile = Array.from(
    { length: 60 },
    (_, i) => `[[package]]\nname = "dep${i}"\nversion = "1.0.0"`,
  ).join("\n");
  assert.equal(countLockedPackages(lockfile), 60);

  const heavy = estimatePythonImageMb(4_000, countLockedPackages(lockfile));
  const bare = estimatePythonImageMb(4_000, 0);
  assert.ok(heavy > bare, "more packages must raise the estimate");
  assert.ok(bare >= 500, `even a bare project needs headroom, got ${bare}MB`);
  assert.ok(heavy >= 960, `60 packages needs real room, got ${heavy}MB`);
});
