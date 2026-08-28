import assert from "node:assert/strict";
import test from "node:test";

import { renderTypeScriptContainerfile } from "./oci.js";

test("renders a pinned non-root Node agent image", () => {
  const containerfile = renderTypeScriptContainerfile();
  assert.match(containerfile, /^FROM node:22-bookworm-slim@sha256:[a-f0-9]{64}/);
  assert.match(containerfile, /USER 10000:10000/);
  assert.match(containerfile, /ENTRYPOINT \["node", "\/opt\/agent\/agent.mjs"\]/);
  assert.doesNotMatch(containerfile, /latest/);
});
