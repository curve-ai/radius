import type { WorkspaceSessionRecord } from "./project-context-value";

export function hasUnreadAssistantMessage(
  session: WorkspaceSessionRecord,
  activeSessionId: string | null,
  readAtBySession: Readonly<Record<string, string>>,
): boolean {
  if (
    session.id === activeSessionId ||
    session.lastAssistantMessageAt === null
  ) {
    return false;
  }

  const readAt = readAtBySession[session.id];
  return (
    readAt === undefined ||
    Date.parse(session.lastAssistantMessageAt) > Date.parse(readAt)
  );
}
