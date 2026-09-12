import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { isLocalDevelopmentAuth } from "./development-auth.js";

/** Only loopback development may generate a persistent machine-local secret. */
export function ensureDevelopmentAuthSecret(
  environment: NodeJS.ProcessEnv,
): void {
  if (
    environment.BETTER_AUTH_SECRET?.trim() ||
    !isLocalDevelopmentAuth(environment)
  )
    return;
  if (process.platform === "win32")
    throw new Error(
      "Set BETTER_AUTH_SECRET explicitly on Windows; automatic private-file creation requires POSIX permissions",
    );
  const directory = resolve(environment.RADIUS_LOCAL_STATE_DIR ?? ".radius");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = resolve(directory, "auth-secret");
  try {
    writeFileSync(filename, randomBytes(48).toString("base64url"), {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = lstatSync(filename);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 4096)
    throw new Error("Local auth secret must be a private regular file (0600)");
  environment.BETTER_AUTH_SECRET = readFileSync(filename, "utf8").trim();
}
