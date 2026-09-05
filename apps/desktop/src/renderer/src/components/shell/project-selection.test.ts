import assert from "node:assert/strict";
import test from "node:test";

import { resolveActiveProjectId } from "./project-selection";

test("leaves a new standalone chat without project context", () => {
  assert.equal(
    resolveActiveProjectId({
      currentProjectId: null,
      projectIds: ["project-one", "project-two"],
      recentSessionActive: false,
      storedSessionProjectId: null,
    }),
    null,
  );
});

test("preserves an explicitly selected project", () => {
  assert.equal(
    resolveActiveProjectId({
      currentProjectId: "project-two",
      projectIds: ["project-one", "project-two"],
      recentSessionActive: false,
      storedSessionProjectId: null,
    }),
    "project-two",
  );
});

test("uses the project belonging to the active session", () => {
  assert.equal(
    resolveActiveProjectId({
      currentProjectId: null,
      projectIds: ["project-one"],
      recentSessionActive: false,
      storedSessionProjectId: "project-one",
    }),
    "project-one",
  );
});

test("standalone sessions clear stale project context", () => {
  assert.equal(
    resolveActiveProjectId({
      currentProjectId: "project-one",
      projectIds: ["project-one"],
      recentSessionActive: true,
      storedSessionProjectId: null,
    }),
    null,
  );
});
