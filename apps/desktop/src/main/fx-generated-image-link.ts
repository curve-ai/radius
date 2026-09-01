export function fxStateRelativeImagePath(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== "sandbox:" || url.hostname) return null;
    const statePrefix = "/opt/data/";
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith(statePrefix)) return null;
    const relativePath = pathname.slice(statePrefix.length);
    if (
      !relativePath ||
      relativePath.includes("\\") ||
      relativePath
        .split("/")
        .some((segment) => !segment || segment === "." || segment === "..")
    ) {
      return null;
    }
    return relativePath;
  } catch {
    return null;
  }
}
