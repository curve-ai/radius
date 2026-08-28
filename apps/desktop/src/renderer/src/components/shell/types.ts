export type WorkspaceView =
  | "workspace"
  | "scheduled"
  | "connectors"
  | "agents"
  | "projects"
  | "artifacts"
  | "activity"
  | "settings";

export const WORKSPACE_TITLES: Record<WorkspaceView, string> = {
  workspace: "New chat",
  scheduled: "Scheduled",
  connectors: "Connectors",
  agents: "Agents",
  projects: "Projects",
  artifacts: "Artifacts",
  activity: "Activity",
  settings: "Account settings",
};
