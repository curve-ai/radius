import type { SessionUpdate } from "@curve-ai/radius-runtime";

const MAX_AGENT_SESSION_TITLE_LENGTH = 120;

interface AgentSessionTitleTarget {
  updateTitle(title: string): Promise<void>;
}

function normalizeAgentSessionTitle(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return Array.from(normalized)
    .slice(0, MAX_AGENT_SESSION_TITLE_LENGTH)
    .join("")
    .trimEnd();
}

export async function applyAgentSessionTitleUpdate(
  target: AgentSessionTitleTarget,
  update: SessionUpdate,
): Promise<boolean> {
  if (update.sessionUpdate !== "session_info_update") return false;
  if (typeof update.title !== "string") return true;
  const title = normalizeAgentSessionTitle(update.title);
  if (title) await target.updateTitle(title);
  return true;
}
