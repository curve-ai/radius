import { NativeOAuthConfigurationSchema } from "../packages/platform-contracts/src/index.js";
import { validatedPlatformUrl } from "../apps/desktop/src/main/platform-endpoint.js";

export class PlatformUnavailableError extends Error {}

/** Readiness is about the native auth contract, not a generic /health response. */
export async function checkPlatformAuth(
  value: string,
  request: typeof fetch = fetch,
): Promise<void> {
  const base = validatedPlatformUrl(value);
  let response: Response;
  try {
    response = await request(
      new URL("api/platform/v1/auth/native/config", base),
      {
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: { accept: "application/json" },
      },
    );
  } catch {
    throw new PlatformUnavailableError(
      `Platform is unreachable at ${base.href}. Start the Radius Platform API before opening the desktop.`,
    );
  }
  if (response.status === 404) {
    throw new Error(
      `${base.href} does not serve the Radius native-auth API. Check the Platform URL and the process using that port.`,
    );
  }
  if (response.status === 503) {
    throw new Error(
      `Native sign-in is not configured or its issuer is unavailable at ${base.href}. Load the organization's native-auth configuration and verify its registered OAuth client.`,
    );
  }
  if (!response.ok)
    throw new Error(
      `Platform native-auth readiness failed (HTTP ${response.status}).`,
    );
  const text = await response.text();
  if (text.length > 65_536)
    throw new Error("Platform native-auth response is too large");
  const body = JSON.parse(text) as Record<string, unknown>;
  const { authorizationEndpoint, ...configuration } = body;
  NativeOAuthConfigurationSchema.parse(configuration);
  if (typeof authorizationEndpoint !== "string")
    throw new Error("Platform did not return an authorization endpoint");
  validatedPlatformUrl(authorizationEndpoint);
}
