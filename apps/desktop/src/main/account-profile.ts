import type { DesktopAuthenticationStatus } from "../auth-types";

/** Copy only bounded, non-secret presentation fields across preload. */
export function accountProfile(
  value: unknown,
): DesktopAuthenticationStatus["profile"] {
  if (!value || typeof value !== "object") return null;
  const profile = value as Record<string, unknown>;
  const text = (input: unknown, limit: number): string | null =>
    typeof input === "string"
      ? input
          .replace(/\p{Cc}/gu, "")
          .trim()
          .slice(0, limit) || null
      : null;
  return {
    displayName: text(profile.displayName, 120),
    email: text(profile.email, 320),
  };
}
