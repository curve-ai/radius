// A `radius://dev-agent/<id>` link names an agent that `radius dev` has only
// just registered, so the agent list may not include it yet. The request
// waits here until a load that does include it consumes it.
let request: { agentId: string; at: number } | null = null;
const listeners = new Set<() => void>();

// Registration reaches the agent list within seconds. A request older than
// this belongs to an agent that never became usable, and honoring it later
// would switch the selection without the user asking.
export const AGENT_LINK_REQUEST_TTL_MS = 60_000;

export function requestAgentFromLink(agentId: string, now = Date.now()): void {
  request = { agentId, at: now };
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
  now = Date.now(),
): T | null {
  if (request && now - request.at > AGENT_LINK_REQUEST_TTL_MS) request = null;
  const linked = request
    ? agents.find((agent) => agent.id === request?.agentId)
    : undefined;
  if (linked) request = null;
  return linked ?? agents[0] ?? null;
}
