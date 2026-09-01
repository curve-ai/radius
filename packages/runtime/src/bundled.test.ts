import assert from "node:assert/strict";
import test from "node:test";

import { parseBundledAgentIndex } from "./bundled.js";

test("accepts company-bundled agent project mappings", () => {
  const index = parseBundledAgentIndex({
    schemaVersion: 1,
    agents: [
      {
        project: "proj_radius_fx",
        imageLayout: "fx/oci-layout",
      },
    ],
  });
  assert.equal(index.agents[0]?.project, "proj_radius_fx");
});

test("rejects duplicate projects and escaping resource paths", () => {
  assert.throws(() =>
    parseBundledAgentIndex({
      schemaVersion: 1,
      agents: [
        {
          project: "proj_radius_fx",
          imageLayout: "../fx/oci-layout",
        },
        {
          project: "proj_radius_fx",
          imageLayout: "fx/oci-layout-2",
        },
      ],
    }),
  );
});
