import { spawn } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
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
    /* generic local-only Radius */
  }
}
let temporary: string | undefined;
try {
  if (flag >= 0) {
    if (!configPath)
      throw new Error("Run bun run auth:setup before using --url.");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.platformUrl = new URL(args[flag + 1]!).href;
    temporary = await mkdtemp(path.join(tmpdir(), "radius-dev-auth-"));
    configPath = path.join(temporary, "distribution.json");
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    args.splice(flag, 2);
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
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
