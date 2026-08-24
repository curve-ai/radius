export function validatedCloudUrl(value: string): URL {
  const url = new URL(value);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error(
      "Cloud URLs must use HTTPS except on loopback development hosts",
    );
  }
  return url;
}
