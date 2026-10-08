export type HostImagePlatform = "linux/arm64" | "linux/amd64";

export function hostImagePlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): HostImagePlatform {
  return platform === "win32" && arch === "x64"
    ? "linux/amd64"
    : "linux/arm64";
}
