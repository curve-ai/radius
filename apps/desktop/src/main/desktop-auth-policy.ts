import type { NativeAuthorizationResponse } from "@curve-ai/platform-contracts";

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
