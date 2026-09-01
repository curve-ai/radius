import type { StartAgentPromptInput } from "../radius-api";

export type AgentAccessMode = StartAgentPromptInput["accessMode"];

export function needsTerminalApproval(
  accessMode: AgentAccessMode,
  outsideProjectRoots: boolean,
): boolean {
  return (
    accessMode === "ask" || (accessMode === "project" && outsideProjectRoots)
  );
}

export function needsFileApproval(
  accessMode: AgentAccessMode,
  operation: "read" | "write",
  outsideProjectRoots: boolean,
): boolean {
  return (
    (accessMode === "project" && outsideProjectRoots) ||
    (accessMode === "ask" && (outsideProjectRoots || operation === "write"))
  );
}
