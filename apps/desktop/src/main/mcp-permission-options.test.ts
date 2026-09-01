import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_MCP_TOOL_BINDINGS,
  browserMcpToolName,
  mcpAvailableSelections,
  mcpOptionIdForSelection,
  mcpPermissionOptionIds,
  normalizeBrowserMcpToolName,
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

test("normalizes namespaced ACP browser tool names for host enforcement", () => {
  assert.equal(browserMcpToolName("page.snapshot"), "browser_snapshot");
  assert.equal(
    browserMcpToolName("control.release"),
    "browser_control_release",
  );
  assert.equal(
    normalizeBrowserMcpToolName("mcp__radius-browser__browser_snapshot"),
    "browser_snapshot",
  );
  assert.equal(normalizeBrowserMcpToolName("unknown_tool"), null);
  assert.equal(
    new Set(BROWSER_MCP_TOOL_BINDINGS.map((binding) => binding.nativeToolName))
      .size,
    BROWSER_MCP_TOOL_BINDINGS.length,
  );
});

test("uses ACP allow-always when it is the only positive option", () => {
  const options = mcpPermissionOptionIds([
    { kind: "allow_always", name: "Always allow", optionId: "always" },
    { kind: "reject_always", name: "Never allow", optionId: "never" },
  ]);
  assert.equal(mcpOptionIdForSelection(options, "allow_once"), "always");
  assert.equal(mcpOptionIdForSelection(options, "allow_server"), "always");
});
