import { access, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  AgentConfigSchema,
  type AgentConfig,
} from "@curve-ai/agent-contracts";
import { tsImport } from "tsx/esm/api";
import { parse as parseToml } from "smol-toml";

const CONFIG_FILES = [
  "radius.config.ts",
  "radius.config.mts",
  "radius.config.js",
  "radius.config.mjs",
  "radius.config.json",
  "pyproject.toml",
] as const;

export async function findAgentConfig(root: string): Promise<string> {
  for (const filename of CONFIG_FILES) {
    const candidate = join(root, filename);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue until a supported configuration file exists.
    }
  }
  throw new Error(
    `No Radius config found in ${root}. Run \"radius init\" first.`,
  );
}

export async function loadAgentConfig(
  root: string,
  explicitPath?: string,
): Promise<{ config: AgentConfig; path: string }> {
  const configPath = explicitPath
    ? isAbsolute(explicitPath)
      ? explicitPath
      : join(root, explicitPath)
    : await findAgentConfig(root);

  const value = configPath.endsWith(".json")
    ? JSON.parse(await readFile(configPath, "utf8"))
    : configPath.endsWith(".toml")
      ? parsePyproject(await readFile(configPath, "utf8"), configPath)
      : await importConfig(configPath);

  return { config: AgentConfigSchema.parse(value), path: configPath };
}

function parsePyproject(source: string, path: string): unknown {
  const document = parseToml(source) as {
    tool?: { radius?: unknown };
  };
  if (document.tool?.radius === undefined) {
    throw new Error(`Radius config ${path} must define [tool.radius]`);
  }
  return document.tool.radius;
}

async function importConfig(configPath: string): Promise<unknown> {
  const url = pathToFileURL(configPath).href;
  const imported = (await tsImport(url, import.meta.url)) as {
    default?: unknown;
  };
  if (!("default" in imported)) {
    throw new Error(`Radius config ${configPath} must have a default export`);
  }
  const value = imported.default;
  if (
    value &&
    typeof value === "object" &&
    Object.keys(value).length === 1 &&
    "default" in value
  ) {
    return (value as { default: unknown }).default;
  }
  return value;
}
