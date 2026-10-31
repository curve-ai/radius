// A `radius://dev-agent/<id>` link names an agent that `radius dev` has only
// just registered, so the agent list may not include it yet. The request
// waits here until a load that does include it consumes it.
let requestedAgentId: string | null = null;
const listeners = new Set<() => void>();

export function requestAgentFromLink(agentId: string): void {
  requestedAgentId = agentId;
  for (const listener of listeners) listener();
}

export function onAgentLinkRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Picks the agent a pending link asked for when it is available, consuming
 * the request, and otherwise the default first agent.
 */
export function takeLinkedAgent<T extends { id: string }>(
  agents: readonly T[],
): T | null {
  const linked = requestedAgentId
    ? agents.find((agent) => agent.id === requestedAgentId)
    : undefined;
  if (linked) requestedAgentId = null;
  return linked ?? agents[0] ?? null;
}
