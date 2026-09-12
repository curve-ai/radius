import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

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
    /* default Radius bundle */
  }
}
const platformUrl =
  flag >= 0 ? new URL(args[flag + 1]!).href : process.env.RADIUS_PLATFORM_URL;
if (flag >= 0) args.splice(flag, 2);
const child = spawn(
  process.execPath,
  ["run", "--cwd", "apps/desktop", "dev", ...args],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(configPath
        ? { RADIUS_DISTRIBUTION_CONFIG: path.resolve(configPath) }
        : {}),
      ...(platformUrl ? { RADIUS_PLATFORM_URL: platformUrl } : {}),
    },
  },
);
const forward = () => child.kill("SIGTERM");
process.once("SIGINT", forward);
process.once("SIGTERM", forward);
process.exitCode = await new Promise<number>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
