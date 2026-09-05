export function resolveActiveProjectId(input: {
  currentProjectId: string | null;
  projectIds: readonly string[];
  recentSessionActive: boolean;
  storedSessionProjectId: string | null;
}): string | null {
  if (input.recentSessionActive) return null;
  if (input.storedSessionProjectId) return input.storedSessionProjectId;
  return input.currentProjectId &&
    input.projectIds.includes(input.currentProjectId)
    ? input.currentProjectId
    : null;
}
