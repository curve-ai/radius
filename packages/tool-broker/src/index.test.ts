import assert from "node:assert/strict";
import test from "node:test";

import { resolveAgentConnectorAvailability } from "./index.js";

const interfaceRequired = {
  kind: "radius.mcp" as const,
  requirement: "required" as const,
  declaration: "manifest" as const,
  protocolVersions: ["2026-07-28"],
};

const request = {
  key: "presentations",
  operation: "create",
  contractVersion: 1,
  requirement: "required" as const,
};

test("hides an agent whose required connector is unavailable", () => {
  assert.deepEqual(
    resolveAgentConnectorAvailability({
      interfaces: [interfaceRequired],
      capabilityRequests: [request],
      bindings: [],
    }),
    {
      selectable: false,
      exposeMcpBridge: false,
      availableCapabilities: [],
      missingRequiredCapabilities: [request],
    },
  );
});

test("omits optional MCP without hiding the agent", () => {
  const result = resolveAgentConnectorAvailability({
    interfaces: [{ ...interfaceRequired, requirement: "optional" }],
    capabilityRequests: [{ ...request, requirement: "optional" }],
    bindings: [],
  });
  assert.equal(result.selectable, true);
  assert.equal(result.exposeMcpBridge, false);
});

test("exposes MCP only for a connected healthy exact binding", () => {
  const result = resolveAgentConnectorAvailability({
    interfaces: [interfaceRequired],
    capabilityRequests: [request],
    bindings: [
      {
        providerId: "provider-1",
        capabilityKey: "presentations",
        operation: "create",
        contractVersion: 1,
        connected: true,
        healthy: true,
      },
    ],
  });
  assert.equal(result.selectable, true);
  assert.equal(result.exposeMcpBridge, true);
});
