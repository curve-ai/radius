import { DevelopmentAgentConnectionSchema } from "@curve-ai/radius-runtime";

export const AGENT_LINK_PROTOCOL = "radius";

/**
 * Returns the agent id from `radius://dev-agent/<agentId>`, or null for any
 * other input. The link arrives from outside the app, so anything that is not
 * exactly that shape with a well-formed id is ignored rather than repaired.
 */
export function developmentAgentIdFromLink(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== `${AGENT_LINK_PROTOCOL}:`) return null;
  if (url.hostname !== "dev-agent") return null;
  if (url.username || url.password || url.port) return null;
  if (url.search || url.hash) return null;
  const agentId = url.pathname.replace(/^\//, "").replace(/\/$/, "");
  return DevelopmentAgentConnectionSchema.shape.agentId.safeParse(agentId)
    .success
    ? agentId
    : null;
}

/**
 * Windows and Linux deliver a link as a command-line argument, to the first
 * launch or through `second-instance`. Only the first link counts. A bare
 * AppImage has no installed desktop entry, so the scheme is never registered
 * there; `radius dev` passes the link to the executable as an argument instead.
 */
export function developmentAgentIdFromArgv(
  argv: readonly string[],
): string | null {
  const link = argv.find((argument) =>
    argument.toLowerCase().startsWith(`${AGENT_LINK_PROTOCOL}://`),
  );
  return link ? developmentAgentIdFromLink(link) : null;
}
