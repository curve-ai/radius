import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { parseDevelopmentAgentConnection } from "@curve-ai/radius-runtime";

import { OperationalError } from "./errors.js";

export function radiusUserDataPath(
  platform: string,
  env: NodeJS.ProcessEnv,
): string {
  const explicit = env.RADIUS_USER_DATA_PATH?.trim();
  if (explicit) return resolve(explicit);
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Radius");
  }
  if (platform === "win32") {
    const appData = env.APPDATA?.trim();
    if (!appData) {
      throw new OperationalError("APPDATA is required to locate Radius.");
    }
    return join(appData, "Radius");
  }
  return join(env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config"), "Radius");
}

export interface Registration {
  readonly path: string;
  remove(): Promise<void>;
}

/**
 * The CLI is the descriptor's sole writer. Keyed on agent id plus an instance
 * id so two `dev` sessions for one agent cannot clobber each other.
 */
export async function registerDevelopmentAgent(input: {
  userDataPath: string;
  agentId: string;
  instanceId: string;
  displayName: string;
  endpoint: string;
  token: string;
  cwd: string;
  ownerPid: number;
  capabilities: readonly string[];
}): Promise<Registration> {
  const descriptor = parseDevelopmentAgentConnection({
    schemaVersion: 1,
    agentId: input.agentId,
    displayName: input.displayName,
    endpoint: input.endpoint,
    authorization: `Bearer ${input.token}`,
    cwd: input.cwd,
    ownerPid: input.ownerPid,
    capabilities: [...input.capabilities],
    registeredAt: new Date().toISOString(),
  });

  const path = join(
    input.userDataPath,
    "development",
    "agents",
    `${input.agentId}-${input.instanceId}.json`,
  );
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${input.ownerPid}`;
  await writeFile(temporary, `${JSON.stringify(descriptor, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);

  return {
    path,
    async remove() {
      await rm(path, { force: true });
    },
  };
}
