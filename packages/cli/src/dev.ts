import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  parseDevelopmentAgentConnection,
  type DevelopmentAgentConnection,
} from "@curve-ai/radius-runtime";

import { loadAgentConfig } from "./config.js";
import type { CliIo } from "./io.js";

export interface DevOptions {
  root: string;
  configPath?: string;
  endpoint?: string;
  authorizationEnv?: string;
  userDataPath?: string;
  io: CliIo;
  launchDesktop?: () => Promise<void>;
  waitForExit?: () => Promise<void>;
}

export async function runDevelopmentAgent(options: DevOptions): Promise<void> {
  const loaded = await loadAgentConfig(options.root, options.configPath);
  const initial = developmentConnection(options, loaded.config);
  const registrationPath = developmentRegistrationPath(
    options.userDataPath ?? radiusUserDataPath(),
    initial.agentId,
  );
  await writeDevelopmentRegistration(registrationPath, initial);

  let watcher: FSWatcher | null = null;
  let reloadTimer: NodeJS.Timeout | null = null;
  try {
    await (options.launchDesktop ?? launchRadiusDesktop)();
    options.io.out(`Radius development agent: ${initial.displayName}`);
    options.io.out(`ACP endpoint: ${initial.endpoint}`);
    options.io.out("Radius is using the agent's live development process.");
    options.io.out("Press Ctrl-C to disconnect it from Radius.");

    watcher = watch(
      dirname(loaded.path),
      { persistent: true },
      (_event, file) => {
        if (file?.toString() !== basename(loaded.path)) return;
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          reloadTimer = null;
          void reloadDevelopmentRegistration({
            ...options,
            configPath: loaded.path,
            expectedAgentId: initial.agentId,
            registrationPath,
          });
        }, 75);
      },
    );
    await (options.waitForExit ?? waitForTerminationSignal)();
  } finally {
    watcher?.close();
    if (reloadTimer) clearTimeout(reloadTimer);
    await rm(registrationPath, { force: true });
  }
}

async function reloadDevelopmentRegistration(
  options: DevOptions & {
    expectedAgentId: string;
    registrationPath: string;
  },
): Promise<void> {
  try {
    const loaded = await loadAgentConfig(options.root, options.configPath);
    const connection = developmentConnection(options, loaded.config);
    if (connection.agentId !== options.expectedAgentId) {
      throw new Error(
        "Agent identity cannot change while radius dev is running",
      );
    }
    await writeDevelopmentRegistration(options.registrationPath, connection);
    options.io.out("Reloaded Radius development configuration.");
  } catch (error) {
    options.io.error(
      `Radius kept the last valid development configuration: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function developmentConnection(
  options: Pick<DevOptions, "root" | "endpoint" | "authorizationEnv">,
  config: Awaited<ReturnType<typeof loadAgentConfig>>["config"],
): DevelopmentAgentConnection {
  const endpoint = options.endpoint ?? config.development?.endpoint;
  if (!endpoint) {
    throw new Error(
      "radius dev requires development.endpoint in the Radius config or --endpoint",
    );
  }
  const authorizationEnv =
    options.authorizationEnv ?? config.development?.authorizationEnv ?? null;
  const authorization = authorizationEnv
    ? process.env[authorizationEnv]?.trim()
    : null;
  if (authorizationEnv && !authorization) {
    throw new Error(
      `Development authorization variable ${authorizationEnv} is empty`,
    );
  }
  const root = resolve(options.root);
  const agentId =
    config.agent ??
    `agent_dev_${createHash("sha256").update(root).digest("hex").slice(0, 16)}`;
  return parseDevelopmentAgentConnection({
    schemaVersion: 1,
    agentId,
    displayName: config.name,
    endpoint,
    authorization: authorization ? `Bearer ${authorization}` : null,
    cwd: root,
    ownerPid: process.pid,
    capabilities: config.capabilities.flatMap((capability) =>
      capability.operations.map(
        (operation) => `${capability.key}.${operation}`,
      ),
    ),
    registeredAt: new Date().toISOString(),
  });
}

export function radiusUserDataPath(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = environment.RADIUS_USER_DATA_PATH?.trim();
  if (explicit) return resolve(explicit);
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Radius");
  }
  if (platform === "win32") {
    const appData = environment.APPDATA?.trim();
    if (!appData) throw new Error("APPDATA is required to locate Radius");
    return join(appData, "Radius");
  }
  return join(
    environment.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config"),
    "Radius",
  );
}

export function developmentRegistrationPath(
  userDataPath: string,
  agentId: string,
): string {
  return join(userDataPath, "development", "agents", `${agentId}.json`);
}

export async function writeDevelopmentRegistration(
  registrationPath: string,
  connection: DevelopmentAgentConnection,
): Promise<void> {
  await mkdir(dirname(registrationPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${registrationPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(connection, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, registrationPath);
}

async function launchRadiusDesktop(): Promise<void> {
  const explicitPath = process.env.RADIUS_DESKTOP_PATH?.trim();
  if (explicitPath) {
    const child = spawn(resolve(explicitPath), [], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return;
  }
  if (process.platform === "darwin") {
    await runLauncher("open", ["-a", "Radius"]);
    return;
  }
  if (process.platform === "win32") {
    await runLauncher("cmd", ["/c", "start", "", "Radius"]);
    return;
  }
  await runLauncher("gtk-launch", ["ai.curve.radius"]);
}

async function runLauncher(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolveLaunch, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolveLaunch();
      else
        reject(
          new Error(`Could not launch Radius (${command} exited ${code})`),
        );
    });
  });
}

async function waitForTerminationSignal(): Promise<void> {
  await new Promise<void>((resolveWait) => {
    const finish = (): void => {
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      resolveWait();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}
