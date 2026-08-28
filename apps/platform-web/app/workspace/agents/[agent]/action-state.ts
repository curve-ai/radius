export type DeploymentActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };
