import type { AgentReleaseDescriptor } from "./release.js";

/** Why an agent image cannot run on this computer, or null when it can. */
export function hostImageMismatch(
  image: AgentReleaseDescriptor["image"],
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  if (platform === "win32") {
    if (arch !== "x64") {
      return "Radius agents on Windows require an x64 (Intel or AMD) computer";
    }
    if (image.platform !== "linux/amd64") {
      return `This Windows PC cannot run ${image.platform} agent images; it needs linux/amd64`;
    }
    if (image.translation !== "native") {
      return 'linux/amd64 agents run directly on Windows; the release must use translation "native"';
    }
    return null;
  }
  if (image.translation === "native") {
    return 'Translation "native" is only for Windows x64; on this computer linux/amd64 images need Rosetta';
  }
  return null;
}
