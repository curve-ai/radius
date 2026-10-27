import type { RequestPermissionRequest } from "@curve-ai/radius-runtime";

import type { ToolApprovalSelection } from "../radius-api";

export interface McpPermissionOptionIds {
  allowAlways: string | null;
  allowOnce: string | null;
  reject: string | null;
}

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
