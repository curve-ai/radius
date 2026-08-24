export const WORKSPACE_SIDEBAR_DEFAULT_WIDTH = 256;
export const WORKSPACE_SIDEBAR_MIN_WIDTH = 224;
export const WORKSPACE_SIDEBAR_MAX_WIDTH = 480;

export function clampWorkspaceSidebarWidth(width: number): number {
  return Math.min(
    WORKSPACE_SIDEBAR_MAX_WIDTH,
    Math.max(WORKSPACE_SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}
