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
