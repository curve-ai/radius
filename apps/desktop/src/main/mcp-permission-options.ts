import type { RequestPermissionRequest } from "@curve-ai/radius-runtime";
import type { BrowserBridgeOperation } from "@curve-ai/radius-browser-protocol";

import type { ToolApprovalSelection } from "../radius-api";

export interface McpPermissionOptionIds {
  allowAlways: string | null;
  allowOnce: string | null;
  reject: string | null;
}

export const BROWSER_MCP_TOOL_BINDINGS: ReadonlyArray<{
  nativeToolName: string;
  operation: BrowserBridgeOperation;
  riskClass: "read" | "external_side_effect";
}> = [
  {
    nativeToolName: "browser_wait",
    operation: "browser.status",
    riskClass: "read",
  },
  {
    nativeToolName: "browser_tabs_list",
    operation: "tabs.list",
    riskClass: "read",
  },
  {
    nativeToolName: "browser_tabs_create",
    operation: "tabs.create",
    riskClass: "external_side_effect",
  },
  {
    nativeToolName: "browser_tabs_activate",
    operation: "tabs.activate",
    riskClass: "external_side_effect",
  },
  {
    nativeToolName: "browser_tabs_close",
    operation: "tabs.close",
    riskClass: "external_side_effect",
  },
  {
    nativeToolName: "browser_navigate",
    operation: "page.navigate",
    riskClass: "external_side_effect",
  },
  {
    nativeToolName: "browser_snapshot",
    operation: "page.snapshot",
    riskClass: "read",
  },
  {
    nativeToolName: "browser_click",
    operation: "page.click",
    riskClass: "external_side_effect",
  },
  {
    nativeToolName: "browser_type",
    operation: "page.type",
    riskClass: "external_side_effect",
  },
  {
    nativeToolName: "browser_key",
    operation: "page.key",
    riskClass: "external_side_effect",
  },
  {
    nativeToolName: "browser_scroll",
    operation: "page.scroll",
    riskClass: "external_side_effect",
  },
  {
    nativeToolName: "browser_screenshot",
    operation: "page.screenshot",
    riskClass: "read",
  },
];

const BROWSER_MCP_TOOL_NAME_BY_OPERATION: ReadonlyMap<
  BrowserBridgeOperation,
  string
> = new Map([
  ...BROWSER_MCP_TOOL_BINDINGS.map(
    ({ nativeToolName, operation }) => [operation, nativeToolName] as const,
  ),
  ["control.release", "browser_control_release"],
]);

const BROWSER_MCP_TOOL_NAMES = BROWSER_MCP_TOOL_BINDINGS.map(
  ({ nativeToolName }) => nativeToolName,
);

export function mcpPermissionOptionIds(
  options: RequestPermissionRequest["options"],
): McpPermissionOptionIds {
  const find = (
    kind: "allow_once" | "allow_always" | "reject_once" | "reject_always",
  ): string | null =>
    options.find((candidate) => candidate.kind === kind)?.optionId ?? null;
  return {
    allowAlways: find("allow_always"),
    allowOnce: find("allow_once"),
    reject: find("reject_once") ?? find("reject_always"),
  };
}

export function mcpOptionIdForSelection(
  options: McpPermissionOptionIds,
  selection: ToolApprovalSelection,
): string | null {
  if (selection === "allow_always") return options.allowAlways;
  if (selection === "allow_once" || selection === "allow_server") {
    return options.allowOnce ?? options.allowAlways;
  }
  return options.reject;
}

export function mcpAvailableSelections(
  options: McpPermissionOptionIds,
): Set<ToolApprovalSelection> {
  const selections = new Set<ToolApprovalSelection>();
  if (options.allowOnce) selections.add("allow_once");
  if (options.allowAlways) selections.add("allow_always");
  if (options.allowOnce || options.allowAlways) selections.add("allow_server");
  if (options.reject) selections.add("denied");
  return selections;
}

export function browserMcpToolName(operation: BrowserBridgeOperation): string {
  const toolName = BROWSER_MCP_TOOL_NAME_BY_OPERATION.get(operation);
  if (!toolName) throw new Error("BROWSER_MCP_OPERATION_UNSUPPORTED");
  return toolName;
}

export function normalizeBrowserMcpToolName(value: string): string | null {
  return (
    BROWSER_MCP_TOOL_NAMES.find(
      (toolName) => value === toolName || value.endsWith(`__${toolName}`),
    ) ?? null
  );
}
