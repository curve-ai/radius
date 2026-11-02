/** Read `langgraph.json` the way the LangGraph CLI does. */

import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

export class ConfigError extends Error {
  override name = "ConfigError";
}

export interface GraphSpec {
  readonly name: string;
  /** `./path/to/file.ts:export`, as written in `langgraph.json`. */
  readonly spec: string;
  readonly description?: string;
}

export interface LangGraphConfig {
  /** Absolute path of `langgraph.json`. */
  readonly path: string;
  /** The directory graph paths are resolved against. */
  readonly root: string;
  readonly graphs: readonly GraphSpec[];
  readonly env?: Readonly<Record<string, unknown>> | string;
}

export function loadConfig(path: string): LangGraphConfig {
  const absolute = resolve(path);
  if (!isFile(absolute)) {
    throw new ConfigError(`LangGraph config not found: ${absolute}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new ConfigError(
      `${absolute} is not valid JSON: ${(error as Error).message}`,
    );
  }
  if (!isRecord(raw)) {
    throw new ConfigError(`${absolute} must contain a JSON object`);
  }

  const graphsRaw = raw.graphs;
  if (!isRecord(graphsRaw) || Object.keys(graphsRaw).length === 0) {
    throw new ConfigError(
      `${absolute} must define a non-empty "graphs" object`,
    );
  }

  const graphs: GraphSpec[] = [];
  for (const [name, value] of Object.entries(graphsRaw)) {
    if (typeof value === "string") {
      graphs.push({ name, spec: value });
    } else if (isRecord(value) && typeof value.path === "string") {
      graphs.push({
        name,
        spec: value.path,
        ...(typeof value.description === "string"
          ? { description: value.description }
          : {}),
      });
    } else {
      throw new ConfigError(
        `graph "${name}" in ${absolute} must be "./path/to/file.ts:export" or an object with a "path" field`,
      );
    }
  }

  const env = raw.env;
  if (env != null && !isRecord(env) && typeof env !== "string") {
    throw new ConfigError(
      `"env" in ${absolute} must be an object or a path to a .env file`,
    );
  }

  return {
    path: absolute,
    root: dirname(absolute),
    graphs,
    ...(env == null ? {} : { env }),
  };
}

/** Load `env` into the process environment without overriding existing values. */
export function applyEnv(config: LangGraphConfig): void {
  if (config.env === undefined) return;
  let values: Readonly<Record<string, unknown>>;
  if (typeof config.env === "string") {
    const envPath = resolve(config.root, config.env);
    if (!isFile(envPath)) {
      throw new ConfigError(`env file not found: ${envPath}`);
    }
    values = parseDotenv(readFileSync(envPath, "utf8"));
  } else {
    values = config.env;
  }
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = String(value);
  }
}

export function parseDotenv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      value[0] === value[value.length - 1] &&
      (value[0] === '"' || value[0] === "'")
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
