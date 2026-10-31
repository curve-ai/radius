import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { desktopPresencePath } from "./desktop-presence.js";

/**
 * Fixtures for the desktop app tests, kept out of the test files so one test
 * file importing them does not run another's tests.
 */

/** A bundle just real enough for the installer: an executable and a version. */
export async function writeFakeBundle(
  bundle: string,
  version: string,
): Promise<void> {
  await mkdir(join(bundle, "Contents", "MacOS"), { recursive: true });
  await writeFile(join(bundle, "Contents", "MacOS", "Radius"), "#!/bin/sh\n", {
    mode: 0o755,
  });
  await writeFile(
    join(bundle, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>
`,
  );
}

/** What a running app writes, as the app writes it. */
export async function writePresence(
  userData: string,
  presence: Record<string, unknown>,
): Promise<void> {
  await mkdir(join(userData, "development"), { recursive: true });
  await writeFile(desktopPresencePath(userData), JSON.stringify(presence));
}
