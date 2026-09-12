import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { access } from "node:fs/promises";
import path from "node:path";
import { nativeEntriesFromEnvironment } from "../apps/platform-api/src/native-auth.js";
import {
  DEVELOPMENT_AUTH,
  isLocalDevelopmentAuth,
} from "../apps/platform-api/src/development-auth.js";

const environment = { ...process.env };
if (
  environment.RADIUS_NATIVE_AUTH_CONFIG === undefined &&
  environment.RADIUS_NATIVE_AUTH_CONFIG_FILE === undefined
) {
  const filename = path.resolve(".radius/native-auth.json");
  try {
    await access(filename);
    environment.RADIUS_NATIVE_AUTH_CONFIG_FILE = filename;
  } catch {
    /* Explicit environment configuration may be used instead. */
  }
}
if (environment.RADIUS_NATIVE_AUTH_CONFIG_FILE)
  environment.RADIUS_NATIVE_AUTH_CONFIG_FILE = path.resolve(
    environment.RADIUS_NATIVE_AUTH_CONFIG_FILE,
  );
const explicitAuth = Object.keys(environment).some(
  (key) =>
    key.startsWith("RADIUS_NATIVE_") ||
    key === "RADIUS_AUTH_ISSUER" ||
    key.startsWith("RADIUS_OIDC_"),
);
if (!explicitAuth && isLocalDevelopmentAuth(environment)) {
  environment.RADIUS_NATIVE_AUTH_CONFIG = JSON.stringify([DEVELOPMENT_AUTH]);
}
if (!nativeEntriesFromEnvironment(environment).length)
  throw new Error(
    "Configure the provisioned organization in .radius/native-auth.json or RADIUS_NATIVE_AUTH_CONFIG before starting the desktop Platform.",
  );
if (!environment.DATABASE_URL)
  throw new Error(
    "Set DATABASE_URL for the local Radius Platform database. This launcher does not reuse Cloud database credentials.",
  );
const port = Number(environment.PORT ?? 3100);
const probe = createServer();
await new Promise<void>((resolve, reject) => {
  probe.once("error", () =>
    reject(
      new Error(
        `Port ${port} is already in use. Stop or relocate the existing service before starting Radius Platform.`,
      ),
    ),
  );
  probe.listen(port, () => probe.close(() => resolve()));
});
const child = spawn(
  process.execPath,
  ["run", "--cwd", "apps/platform-api", "dev"],
  { stdio: "inherit", env: environment },
);
const stop = () => child.kill("SIGTERM");
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.exitCode = await new Promise<number>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
