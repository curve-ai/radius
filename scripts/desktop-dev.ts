import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { DesktopDistributionSchema } from "../packages/platform-contracts/src/index.js";
import { checkPlatformAuth } from "./platform-auth-readiness.js";

const args = process.argv.slice(2);
const flag = args.indexOf("--url");
if (flag >= 0 && !args[flag + 1])
  throw new Error("--url requires a Platform address");
let configPath = process.env.RADIUS_DISTRIBUTION_CONFIG;
if (!configPath) {
  const candidate = path.resolve(".radius/distribution.json");
  try {
    await access(candidate);
    configPath = candidate;
  } catch {
    /* Standard bundle. */
  }
}
const platformUrl =
  flag >= 0
    ? new URL(args[flag + 1]!).href
    : (process.env.RADIUS_PLATFORM_URL ??
      (configPath
        ? DesktopDistributionSchema.parse(
            JSON.parse(await readFile(configPath, "utf8")),
          ).platformUrl
        : "http://localhost:3100/"));
if (flag >= 0) args.splice(flag, 2);
await checkPlatformAuth(platformUrl);
const child = spawn(
  process.execPath,
  ["run", "--cwd", "apps/desktop", "dev", ...args],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      RADIUS_PLATFORM_URL: platformUrl,
      ...(configPath
        ? { RADIUS_DISTRIBUTION_CONFIG: path.resolve(configPath) }
        : {}),
    },
  },
);
const stop = () => child.kill("SIGTERM");
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.exitCode = await new Promise<number>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
