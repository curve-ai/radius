import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Whether this Windows copy came from the NSIS installer, which writes its
 * uninstaller beside the executable. The release zip, which the radius CLI
 * unpacks, has none. Updating such a copy would run the installer and leave a
 * second installation while the CLI's copy stayed old, so the CLI updates it
 * instead.
 */
export async function installedByNsis(
  executablePath: string,
): Promise<boolean> {
  try {
    const entries = await readdir(path.dirname(executablePath));
    return entries.some((name) => /^Uninstall .+\.exe$/i.test(name));
  } catch {
    return false;
  }
}
