import { RequestError } from "@agentclientprotocol/sdk";

export interface RadiusAgentCredential {
  readonly accessToken: string;
  readonly expiresAt: string;
}

/** Create once per ACP connection; the agent owns its handlers and lifecycle. */
export function createRadiusAuthentication(
  verify: (
    credential: RadiusAgentCredential,
    signal: AbortSignal,
  ) => Promise<void>,
) {
  let credential: RadiusAgentCredential | null = null;
  const required = () =>
    RequestError.authRequired({ reason: "AGENT_AUTHENTICATION_REQUIRED" });
  return {
    authMethods: [{ id: "radius-oauth", name: "Organization sign-in" }],
    async authenticate(
      params: { methodId: string; _meta?: Record<string, unknown> | null },
      signal: AbortSignal,
    ) {
      credential = null;
      const value = params._meta?.["ai.radius/auth"] as
        Partial<RadiusAgentCredential> | undefined;
      if (
        params.methodId !== "radius-oauth" ||
        !value ||
        typeof value.accessToken !== "string" ||
        !value.accessToken ||
        value.accessToken.length > 16384 ||
        typeof value.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(value.expiresAt)) ||
        Date.parse(value.expiresAt) <= Date.now()
      )
        throw required();
      const next = {
        accessToken: value.accessToken,
        expiresAt: value.expiresAt,
      };
      try {
        await verify(next, signal);
      } catch {
        throw RequestError.authRequired({
          reason: "AGENT_AUTHENTICATION_FAILED",
        });
      }
      credential = next;
      return {};
    },
    requireCredential(): RadiusAgentCredential {
      if (!credential || Date.parse(credential.expiresAt) <= Date.now())
        throw required();
      return credential;
    },
    clear() {
      credential = null;
    },
  };
}
