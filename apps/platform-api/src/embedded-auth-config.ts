export function authMode(
  environment: NodeJS.ProcessEnv,
): "embedded" | "external" {
  const mode =
    environment.RADIUS_AUTH_MODE ??
    (environment.RADIUS_LOCAL_DEVELOPMENT === "true" ? "embedded" : "external");
  if (mode !== "embedded" && mode !== "external")
    throw new Error("RADIUS_AUTH_MODE must be embedded or external");
  return mode;
}

export function embeddedAuthUrl(environment: NodeJS.ProcessEnv): string {
  const value =
    environment.RADIUS_AUTH_URL ??
    (environment.RADIUS_LOCAL_DEVELOPMENT === "true"
      ? `http://localhost:${environment.PORT ?? "3100"}/api/auth`
      : "");
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/api/auth" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname) &&
        environment.RADIUS_OIDC_ALLOW_INSECURE_LOOPBACK === "true"
      ))
  )
    throw new Error(
      "RADIUS_AUTH_URL must be an HTTPS origin plus /api/auth (explicit loopback development excepted)",
    );
  return url.href;
}

export function embeddedAuthSecret(environment: NodeJS.ProcessEnv): string {
  const secret = environment.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error(
      "Embedded auth requires BETTER_AUTH_SECRET with at least 32 characters",
    );
  return secret;
}
