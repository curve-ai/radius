export type WorkspaceView =
  | "workspace"
  | "scheduled"
  | "plugins"
  | "agents"
  | "projects"
  | "artifacts"
  | "activity"
  | "settings";

export const WORKSPACE_TITLES: Record<WorkspaceView, string> = {
  workspace: "New chat",
  scheduled: "Scheduled",
  plugins: "Plugins",
  agents: "Agents",
  projects: "Projects",
  artifacts: "Artifacts",
  activity: "Activity",
  settings: "Account settings",
};
