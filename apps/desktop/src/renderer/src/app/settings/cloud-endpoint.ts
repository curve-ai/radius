/**
 * Mirrors `validatedCloudUrl` in `apps/desktop/src/main/cloud-url.ts` so the
 * form can reject a bad endpoint inline instead of surfacing a failed promise.
 * The main process remains the enforcing copy; keep the two rules in step.
 */
export type CloudEndpointError = "EMPTY" | "MALFORMED" | "INSECURE";

/**
 * `.localhost` is reserved for loopback by RFC 6761, so `app.localhost` and
 * friends are as local as `localhost` itself and may be reached over HTTP.
 */
function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

export function validateCloudEndpoint(
  value: string,
): CloudEndpointError | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "EMPTY";

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "MALFORMED";
  }

  const loopback = isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    return "INSECURE";
  }
  return null;
}

export function cloudEndpointMessage(error: CloudEndpointError): string {
  switch (error) {
    case "EMPTY":
      return "Enter the address of your Radius Cloud server.";
    case "MALFORMED":
      return "This is not a valid address. Include the scheme, for example https://api.example.com.";
    case "INSECURE":
      return "Cloud addresses must use HTTPS, except on local development hosts such as localhost, app.localhost, or 127.0.0.1.";
  }
}
