import assert from "node:assert/strict";
import test from "node:test";

import {
  mcpAvailableSelections,
  mcpOptionIdForSelection,
  mcpPermissionOptionIds,
} from "./mcp-permission-options";

test("maps ACP permission options to Radius MCP approval scopes", () => {
  const options = mcpPermissionOptionIds([
    { kind: "allow_once", name: "Allow once", optionId: "once" },
    { kind: "allow_always", name: "Always allow", optionId: "always" },
    { kind: "reject_once", name: "Deny", optionId: "deny" },
  ]);
  assert.deepEqual(options, {
    allowAlways: "always",
    allowOnce: "once",
    reject: "deny",
  });
  assert.deepEqual(
    [...mcpAvailableSelections(options)],
    ["allow_once", "allow_always", "allow_server", "denied"],
  );
  assert.equal(mcpOptionIdForSelection(options, "allow_once"), "once");
  assert.equal(mcpOptionIdForSelection(options, "allow_always"), "always");
  assert.equal(mcpOptionIdForSelection(options, "allow_server"), "once");
  assert.equal(mcpOptionIdForSelection(options, "denied"), "deny");
});

test("uses ACP allow-always when it is the only positive option", () => {
  const options = mcpPermissionOptionIds([
    { kind: "allow_always", name: "Always allow", optionId: "always" },
    { kind: "reject_always", name: "Never allow", optionId: "never" },
  ]);
  assert.equal(mcpOptionIdForSelection(options, "allow_once"), "always");
  assert.equal(mcpOptionIdForSelection(options, "allow_server"), "always");
});
