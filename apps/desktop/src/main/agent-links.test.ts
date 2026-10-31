import assert from "node:assert/strict";
import { test } from "node:test";

import {
  developmentAgentIdFromArgv,
  developmentAgentIdFromLink,
} from "./agent-links";

test("reads the agent id from a development agent link", () => {
  assert.equal(
    developmentAgentIdFromLink("radius://dev-agent/agent_abc123"),
    "agent_abc123",
  );
  // Some launchers append a trailing slash when they hand a link over.
  assert.equal(
    developmentAgentIdFromLink("radius://dev-agent/agent_abc123/"),
    "agent_abc123",
  );
});

test("ignores links that are not exactly a development agent link", () => {
  for (const link of [
    "radius://dev-agent/",
    "radius://dev-agent/agent_abc",
    "radius://dev-agent/not-an-agent",
    "radius://dev-agent/agent_abc123/extra",
    "radius://dev-agent/agent_abc123?prompt=hello",
    "radius://dev-agent/agent_abc123#fragment",
    "radius://dev-agent/..%2Fagent_abc123",
    "radius://dev-agent/agent_abc%2F123",
    "radius://user@dev-agent/agent_abc123",
    "radius://dev-agent:8080/agent_abc123",
    "radius://session/agent_abc123",
    "https://dev-agent/agent_abc123",
    "radius:dev-agent/agent_abc123",
    `radius://dev-agent/agent_${"a".repeat(65)}`,
    "not a url",
    "",
  ]) {
    assert.equal(developmentAgentIdFromLink(link), null, link);
  }
});

test("finds a link among command-line arguments", () => {
  assert.equal(
    developmentAgentIdFromArgv([
      "C:\\Program Files\\Radius\\radius.exe",
      "--allow-file-access-from-files",
      "radius://dev-agent/agent_abc123",
    ]),
    "agent_abc123",
  );
  assert.equal(developmentAgentIdFromArgv(["/opt/Radius/radius"]), null);
  assert.equal(
    developmentAgentIdFromArgv(["radius", "radius://dev-agent/../etc"]),
    null,
  );
});
