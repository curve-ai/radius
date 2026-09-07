/**
 * A Radius platform is reached at one base URL that serves both sign-in and
 * the API. Curve Cloud gives each organization its own host; a self-hosted
 * installation is wherever the operator put it. Everything below derives from
 * that single address.
 */

const SYNC_PATH = "api/platform/v1/sync/";

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

/**
 * Normalises to a trailing slash so relative paths resolve against the whole
 * address rather than dropping its last segment.
 */
export function validatedPlatformUrl(value: string): URL {
  const url = new URL(value.trim());
  const loopback = isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error(
      "Platform addresses must use HTTPS except on loopback development hosts",
    );
  }
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  url.search = "";
  url.hash = "";
  return url;
}

export function platformUrl(baseUrl: string, path: string): string {
  return new URL(path, validatedPlatformUrl(baseUrl)).toString();
}

/**
 * Conversation sync lives under the platform API. The signature covers the
 * path as sent, so this prefix is part of what every signed request commits
 * to and must not be rewritten in transit.
 */
export function platformSyncEndpoint(baseUrl: string): string {
  return platformUrl(baseUrl, SYNC_PATH);
}

/**
 * A stored connection keeps the platform base URL. Older records and the
 * `RADIUS_SYNC_ENDPOINT` override may point straight at the sync prefix, so
 * accept either and answer with the base.
 */
export function platformBaseFromEndpoint(endpointUrl: string): string {
  const url = validatedPlatformUrl(endpointUrl);
  if (!url.pathname.endsWith(`/${SYNC_PATH}`)) return url.toString();
  url.pathname = url.pathname.slice(0, -SYNC_PATH.length);
  return url.toString();
}
