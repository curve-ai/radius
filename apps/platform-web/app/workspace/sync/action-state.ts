export type RevokeSyncDeviceActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };
