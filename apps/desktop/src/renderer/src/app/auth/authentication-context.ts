import { createContext, useContext } from "react";
import type { DesktopAuthenticationStatus } from "../../../../auth-types";

export const AuthenticationContext =
  createContext<DesktopAuthenticationStatus | null>(null);
export function useAuthentication(): DesktopAuthenticationStatus | null {
  return useContext(AuthenticationContext);
}

export function accountLabel(
  profile: DesktopAuthenticationStatus["profile"],
): string {
  return (
    profile?.displayName?.trim() || profile?.email?.trim() || "Your account"
  );
}

export function accountInitials(label: string): string {
  const name = label.includes("@") ? label.split("@")[0] : label;
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => Array.from(word)[0] ?? "")
      .join("")
      .toUpperCase() || "R"
  );
}
