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

export function validatedCloudUrl(value: string): URL {
  const url = new URL(value);
  const loopback = isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error(
      "Cloud URLs must use HTTPS except on loopback development hosts",
    );
  }
  return url;
}
