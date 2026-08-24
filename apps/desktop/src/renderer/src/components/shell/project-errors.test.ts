import assert from "node:assert/strict";
import test from "node:test";

import { projectErrorMessage } from "./project-errors";

test("replaces stale Electron project-handler errors with restart guidance", () => {
  assert.equal(
    projectErrorMessage(
      new Error(
        "Error invoking remote method 'radius:list-projects': Error: No handler registered for 'radius:list-projects'",
      ),
      "Projects could not be loaded",
    ),
    "Radius was updated while it was running. Restart Radius to finish loading project support.",
  );
});

test("preserves actionable project errors", () => {
  assert.equal(
    projectErrorMessage(
      new Error("Project root must be a directory"),
      "Project could not be created",
    ),
    "Project root must be a directory",
  );
});
