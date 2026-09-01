import assert from "node:assert/strict";
import test from "node:test";

import { agentErrorMessage } from "./agent-errors";

test("replaces stale Electron agent-handler errors with restart guidance", () => {
  assert.equal(
    agentErrorMessage(
      new Error(
        "Error invoking remote method 'radius:list-agents': Error: No handler registered for 'radius:list-agents'",
      ),
      "Agents could not be loaded",
    ),
    "Radius was updated while it was running. Restart Radius to finish loading agent support.",
  );
});

test("maps immutable release conflicts to safe package guidance", () => {
  assert.equal(
    agentErrorMessage(
      new Error(
        "Error invoking remote method 'radius:list-agents': Error: AGENT_RELEASE_IMMUTABLE_CONFLICT",
      ),
      "Agents could not be loaded",
    ),
    "This agent package changed without a new version. Publish it under a new version, then restart Radius.",
  );
});

test("maps image identity conflicts without exposing release metadata", () => {
  assert.equal(
    agentErrorMessage(
      new Error(
        "Error invoking remote method 'radius:list-agents': Error: AGENT_RELEASE_IMAGE_CONFLICT:image_digest",
      ),
      "Agents could not be loaded",
    ),
    "This agent update does not match its image. Radius kept the installed version; rebuild the agent package and try again.",
  );
});

test("does not expose raw database query failures", () => {
  assert.equal(
    agentErrorMessage(
      new Error(
        "Error invoking remote method 'radius:list-agents': Error: Failed query: insert into \"agent_releases\" params: private-details",
      ),
      "Agents could not be loaded. Restart Radius and try again.",
    ),
    "Agents could not be loaded. Restart Radius and try again.",
  );
});

test("keeps known authentication failures actionable", () => {
  assert.equal(
    agentErrorMessage(
      new Error("Error: FX_LOGIN_TIMEOUT"),
      "Agent sign-in could not be completed",
    ),
    "Codex sign-in timed out. Try connecting again.",
  );
});
