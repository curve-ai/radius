export const WORKSPACE_SIDEBAR_DEFAULT_WIDTH = 256;
export const WORKSPACE_SIDEBAR_MIN_WIDTH = 224;
export const WORKSPACE_SIDEBAR_MAX_WIDTH = 480;
export const WORKSPACE_CONTENT_MIN_WIDTH = 224;

export function getWorkspaceSidebarMaxWidth(viewportWidth: number): number {
  return Math.max(
    WORKSPACE_SIDEBAR_MIN_WIDTH,
    Math.min(
      WORKSPACE_SIDEBAR_MAX_WIDTH,
      Math.floor(viewportWidth) - WORKSPACE_CONTENT_MIN_WIDTH,
    ),
  );
}

export function clampWorkspaceSidebarWidth(
  width: number,
  maxWidth = WORKSPACE_SIDEBAR_MAX_WIDTH,
): number {
  return Math.min(
    Math.max(WORKSPACE_SIDEBAR_MIN_WIDTH, maxWidth),
    Math.max(WORKSPACE_SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}
