import type {
  DesktopDistribution,
  NativeAuthorizationResponse,
  NativeOAuthConfiguration,
} from "@curve-ai/platform-contracts";

export function assertBundleMatchesPlatform(
  distribution: DesktopDistribution | null,
  configuration: NativeOAuthConfiguration,
): void {
  if (
    distribution &&
    (configuration.organizationSlug !== distribution.organizationSlug ||
      configuration.agentId !== distribution.agentId)
  ) {
    throw new Error("AUTH_CONFIGURATION_INVALID");
  }
}

export function assertProfileIdentity(
  previousAccountId: string | null | undefined,
  nextAccountId: string,
): void {
  if (previousAccountId && previousAccountId !== nextAccountId)
    throw new Error("AUTH_PROFILE_MISMATCH");
}

export function assertUsableDesktopSession(
  state: string,
  credentials: NativeAuthorizationResponse | null,
  now = Date.now(),
): void {
  if (
    state !== "ready" ||
    !credentials ||
    !Number.isFinite(Date.parse(credentials.agent.expiresAt)) ||
    Date.parse(credentials.agent.expiresAt) <= now ||
    !Number.isFinite(Date.parse(credentials.platformExpiresAt)) ||
    Date.parse(credentials.platformExpiresAt) <= now
  )
    throw new Error("AUTHENTICATION_REQUIRED");
}
