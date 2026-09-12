import { readFileSync } from "node:fs";

/** Public hosted issuer; selecting it never grants organization membership. */
export const HOSTED_AUTH_ISSUER = "https://app.curvehq.sh/api/auth";

export function resolveAuthIssuer(
  explicit: unknown,
  environment: NodeJS.ProcessEnv,
): string {
  const value =
    explicit !== undefined
      ? explicit
      : (environment.RADIUS_AUTH_ISSUER ??
        environment.RADIUS_OIDC_ISSUER ??
        HOSTED_AUTH_ISSUER);
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error("Auth issuer must be a non-empty URL");
  }
  const url = new URL(value);
  const local =
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.hostname.endsWith(".localhost");
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        local &&
        environment.RADIUS_OIDC_ALLOW_INSECURE_LOOPBACK === "true"
      ))
  ) {
    throw new Error(
      "Auth issuer must use HTTPS except for explicitly enabled loopback development",
    );
  }
  // Issuer identity is exact, including its path and trailing slash.
  return value;
}

/** Public configuration only; credentials remain in the provider and vault. */
export function readNativeAuthConfiguration(
  environment: NodeJS.ProcessEnv,
): unknown {
  const inline = environment.RADIUS_NATIVE_AUTH_CONFIG;
  const filename = environment.RADIUS_NATIVE_AUTH_CONFIG_FILE;
  if (inline !== undefined && filename !== undefined) {
    throw new Error(
      "Set only one of RADIUS_NATIVE_AUTH_CONFIG and RADIUS_NATIVE_AUTH_CONFIG_FILE",
    );
  }
  if (filename !== undefined) {
    if (!filename.trim())
      throw new Error("Native auth configuration filename is empty");
    const bytes = readFileSync(filename);
    if (bytes.length > 1_048_576)
      throw new Error("Native auth configuration is too large");
    return JSON.parse(bytes.toString("utf8"));
  }
  if (inline !== undefined) return JSON.parse(inline);
  const fields = [
    environment.RADIUS_NATIVE_CLIENT_ID,
    environment.RADIUS_NATIVE_ORGANIZATION,
    environment.RADIUS_NATIVE_AGENT_ID,
    environment.RADIUS_NATIVE_RESOURCE,
  ];
  if (!fields.some((field) => field !== undefined)) return undefined;
  if (fields.some((field) => !field?.trim())) {
    throw new Error(
      "Configure RADIUS_NATIVE_CLIENT_ID, RADIUS_NATIVE_ORGANIZATION, RADIUS_NATIVE_AGENT_ID and RADIUS_NATIVE_RESOURCE together",
    );
  }
  return [
    {
      clientId: fields[0],
      organizationSlug: fields[1],
      agentId: fields[2],
      resource: fields[3],
      displayName: environment.RADIUS_NATIVE_DISPLAY_NAME ?? "Radius",
      redirectUri:
        environment.RADIUS_NATIVE_REDIRECT_URI ??
        "http://127.0.0.1:43821/callback",
      scopes: environment.RADIUS_NATIVE_SCOPES?.split(/\s+/).filter(
        Boolean,
      ) ?? ["openid", "profile", "email"],
    },
  ];
}
