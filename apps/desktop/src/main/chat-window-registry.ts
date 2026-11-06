/** Window-local ordering only; never changes sessions, pins, or project membership. */
export class ChatWindowRegistry {
  readonly groups = new Map<
    string,
    { sessionIds: string[]; activeSessionId: string | null }
  >();

  owner(sessionId: string): string {
    return (
      [...this.groups].find(([, group]) =>
        group.sessionIds.includes(sessionId),
      )?.[0] ?? "main"
    );
  }

  move(sessionId: string, target: string, before?: string): void {
    for (const group of this.groups.values()) {
      group.sessionIds = group.sessionIds.filter((id) => id !== sessionId);
      if (group.activeSessionId === sessionId)
        group.activeSessionId = group.sessionIds[0] ?? null;
    }
    if (target === "main") return;
    const group = this.groups.get(target) ?? {
      sessionIds: [],
      activeSessionId: null,
    };
    const index = before ? group.sessionIds.indexOf(before) : -1;
    group.sessionIds.splice(
      index < 0 ? group.sessionIds.length : index,
      0,
      sessionId,
    );
    group.activeSessionId = sessionId;
    this.groups.set(target, group);
  }

  removeWindow(id: string): void {
    this.groups.delete(id);
  }

  detached(): Record<string, string> {
    return Object.fromEntries(
      [...this.groups].flatMap(([id, group]) =>
        group.sessionIds.map((sessionId) => [sessionId, id]),
      ),
    );
  }
}
