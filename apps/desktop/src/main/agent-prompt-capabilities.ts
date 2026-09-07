import type {
  AgentReleaseDescriptor,
  DevelopmentAgentConnection,
} from "@curve-ai/radius-runtime";

import type { DesktopAgentSummary } from "../radius-api";

export type AgentPromptCapabilities = NonNullable<
  DesktopAgentSummary["promptCapabilities"]
>;

export function releasePromptCapabilitiesKey(
  release: AgentReleaseDescriptor,
): string {
  return `release:${release.providerId}:${release.agentId}:${release.image.digest}`;
}

export function developmentPromptCapabilitiesKey(
  connection: DevelopmentAgentConnection,
): string {
  return `development:${connection.agentId}:${connection.endpoint}:${connection.registeredAt}`;
}

export function sameAgentPromptCapabilities(
  left: AgentPromptCapabilities | undefined,
  right: AgentPromptCapabilities,
): boolean {
  return (
    left?.image === right.image &&
    left.audio === right.audio &&
    left.embeddedContext === right.embeddedContext
  );
}
