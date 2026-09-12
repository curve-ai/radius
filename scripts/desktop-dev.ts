import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { DesktopDistributionSchema } from "../packages/platform-contracts/src/index.js";
import {
  checkPlatformAuth,
  PlatformUnavailableError,
} from "./platform-auth-readiness.js";

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
  flag >= 0
    ? new URL(args[flag + 1]!).href
    : (process.env.RADIUS_PLATFORM_URL ??
      (configPath
        ? DesktopDistributionSchema.parse(
            JSON.parse(await readFile(configPath, "utf8")),
          ).platformUrl
        : "http://localhost:3100/"));
if (flag >= 0) args.splice(flag, 2);
let platform: ReturnType<typeof spawn> | undefined;
try {
  await checkPlatformAuth(platformUrl);
} catch (error) {
  const local = new URL(platformUrl);
  if (
    !(error instanceof PlatformUnavailableError) ||
    local.origin !== "http://localhost:3100" ||
    local.pathname !== "/"
  )
    throw error;
  platform = spawn(process.execPath, ["run", "platform:dev"], {
    stdio: "inherit",
    env: { ...process.env, PORT: "3100" },
  });
  let stopped = false;
  platform.once("exit", () => {
    stopped = true;
  });
  platform.once("error", () => {
    stopped = true;
  });
  const stop = () => platform?.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 30 && !stopped; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      try {
        await checkPlatformAuth(platformUrl);
        ready = true;
        break;
      } catch (cause) {
        if (!(cause instanceof PlatformUnavailableError)) throw cause;
      }
    }
    if (!ready)
      throw new Error(
        "Radius Platform did not become ready. Resolve the startup error above before opening the desktop.",
      );
  } catch (cause) {
    stop();
    throw cause;
  }
}
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
const forward = () => {
  child.kill("SIGTERM");
  platform?.kill("SIGTERM");
};
process.once("SIGINT", forward);
process.once("SIGTERM", forward);
try {
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  platform?.kill("SIGTERM");
}
