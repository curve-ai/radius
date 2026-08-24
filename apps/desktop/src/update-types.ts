export type DesktopUpdateState =
  | "unsupported"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type DesktopUpdateStatus = {
  state: DesktopUpdateState;
  currentVersion: string;
  availableVersion: string | null;
  percent: number | null;
  errorCode: "UPDATE_FAILED" | null;
};

export const DESKTOP_UPDATE_CHANNELS = {
  status: "radius:update-status",
  perform: "radius:perform-update",
  changed: "radius:update-status-changed",
} as const;

export function normalizeUpdatePercent(percent: number): number {
  return Math.round(Math.min(100, Math.max(0, percent)));
}

export function desktopUpdateStatusesEqual(
  left: DesktopUpdateStatus,
  right: DesktopUpdateStatus,
): boolean {
  return (
    left.state === right.state &&
    left.currentVersion === right.currentVersion &&
    left.availableVersion === right.availableVersion &&
    left.percent === right.percent &&
    left.errorCode === right.errorCode
  );
}
