import type { DesktopAuthenticationStatus } from "../../../../auth-types";

export function authenticationSurface(
  state: DesktopAuthenticationStatus["state"] | undefined,
  minimumElapsed = true,
): "startup" | "workspace" | "sign-in" {
  if (
    !minimumElapsed ||
    !state ||
    state === "checking" ||
    state === "preparing"
  )
    return "startup";
  return state === "ready" ? "workspace" : "sign-in";
}
