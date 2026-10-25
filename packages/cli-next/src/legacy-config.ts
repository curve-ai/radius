import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { AgentConfigSchema, type AgentConfig } from "@curve-ai/agent-contracts";

import { UsageError } from "./errors.js";

/**
 * Reads the config formats that predate `radius.json`.
 *
 * Kept for one release behind a deprecation warning, so a project written
 * against the old CLI still builds while it migrates. This module is loaded
 * dynamically and only when `radius.json` is absent — `radius.config.ts`
 * needs the `tsx` chain, which is the single biggest startup cost the new
 * CLI exists to avoid paying on every invocation.
 */
const LEGACY_FILES = [
  "radius.config.ts",
  "radius.config.mts",
  "radius.config.js",
  "radius.config.mjs",
  "radius.config.json",
  "pyproject.toml",
] as const;

export interface LegacyConfig {
  readonly config: AgentConfig;
  readonly path: string;
  readonly filename: string;
}

export async function findLegacyConfig(
  root: string,
): Promise<LegacyConfig | null> {
  for (const filename of LEGACY_FILES) {
    const candidate = join(root, filename);
    try {
      await access(candidate);
    } catch {
      continue;
    }
    const value = await readLegacy(candidate, filename);
    // A `pyproject.toml` without `[tool.radius]` is just a Python project
    // that happens to sit here. The old CLI treated it as a broken config and
    // stopped, which is why `build` failed in any project with a Python half.
    if (value === null) continue;
    const result = AgentConfigSchema.safeParse(value);
    if (!result.success) {
      const detail = result.error.issues
        .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("\n");
      throw new UsageError(`${filename} is not a valid agent config:\n${detail}`);
    }
    return { config: result.data, path: candidate, filename };
  }
  return null;
}

async function readLegacy(
  path: string,
  filename: string,
): Promise<unknown | null> {
  if (filename === "pyproject.toml") {
    const { parse } = await import("smol-toml");
    const document = parse(await readFile(path, "utf8")) as {
      tool?: { radius?: unknown };
    };
    return document.tool?.radius ?? null;
  }
  if (path.endsWith(".json")) {
    return JSON.parse(await readFile(path, "utf8"));
  }
  const { tsImport } = await import("tsx/esm/api");
  const imported = (await tsImport(pathToFileURL(path).href, import.meta.url)) as {
    default?: unknown;
  };
  if (!("default" in imported)) {
    throw new UsageError(`${filename} must export a default config object.`);
  }
  return imported.default;
}

/** Reads one named legacy config, for `--config path/to/radius.config.ts`. */
export async function readLegacyConfigFile(
  path: string,
): Promise<AgentConfig> {
  const filename = path.split("/").pop() ?? path;
  const value = await readLegacy(path, filename);
  if (value === null) {
    throw new UsageError(`${filename} defines no [tool.radius] section.`);
  }
  const result = AgentConfigSchema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new UsageError(`${filename} is not a valid agent config:\n${detail}`);
  }
  return result.data;
}
