const MISSING_PROJECT_HANDLER =
  /No handler registered for ['"]radius:(?:list-projects|list-recent-sessions|choose-project-folder|create-project|discard-project-folder-selection|add-project-folder|remove-project-folder|rename-project|rename-session|reveal-project|set-session-pinned)['"]/;

export function projectErrorMessage(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  if (MISSING_PROJECT_HANDLER.test(message)) {
    return "Radius was updated while it was running. Restart Radius to finish loading project support.";
  }
  return message || fallback;
}
