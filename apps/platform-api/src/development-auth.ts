import type { NativeOAuthConfiguration } from "@curve-ai/platform-contracts";
import { HOSTED_AUTH_ISSUER } from "./auth-configuration.js";

export const DEVELOPMENT_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
export const DEVELOPMENT_AUTH: NativeOAuthConfiguration = {
  issuer: HOSTED_AUTH_ISSUER,
  clientId: "radius-desktop-development",
  redirectUri: "http://127.0.0.1:43821/callback",
  scopes: ["openid", "profile", "email"],
  resource: "https://curvehq.sh/radius-development",
  organizationSlug: "dev",
  displayName: "Radius Development",
  agentId: "radius-development",
};

/** Development bootstrap is allowed only on the launcher's isolated loopback database. */
export function isLocalDevelopmentAuth(
  environment: NodeJS.ProcessEnv,
): boolean {
  if (environment.RADIUS_LOCAL_DEVELOPMENT !== "true") return false;
  const database = new URL(environment.DATABASE_URL ?? "invalid:");
  if (
    environment.NODE_ENV === "production" ||
    environment.RADIUS_PLATFORM_SHARED_ORIGINS === "true" ||
    environment.HOST !== "127.0.0.1" ||
    database.hostname !== "127.0.0.1" ||
    database.pathname !== "/radius_development"
  ) {
    throw new Error(
      "Default development auth requires a loopback server and the isolated radius_development database",
    );
  }
  return true;
}
