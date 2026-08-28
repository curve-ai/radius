const CLOUD_WEB_URL =
  import.meta.env.VITE_RADIUS_CLOUD_WEB_URL ?? "http://localhost:3300";

export function cloudPageUrl(pathname: string): string {
  return new URL(pathname, CLOUD_WEB_URL).toString();
}
