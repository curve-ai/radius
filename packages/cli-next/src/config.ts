import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { AgentConfigSchema, type AgentConfig } from "@curve-ai/agent-contracts";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

import { OperationalError, UsageError } from "./errors.js";

export const CONFIG_FILENAME = "radius.json";
export const CONFIG_SCHEMA_URL =
  "https://schemas.curve.ai/radius/agent-config/v1.json";

export function configPath(root: string): string {
  return join(root, CONFIG_FILENAME);
}

/** `agent_` plus 16 hex, matching the contract's agentRef pattern. */
export function mintAgentId(): string {
  return `agent_${randomBytes(8).toString("hex")}`;
}

export async function readRawConfig(root: string): Promise<string | null> {
  try {
    return await readFile(configPath(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export interface LoadedConfig {
  readonly config: AgentConfig;
  readonly path: string;
  /** Set when the config came from a format that is on its way out. */
  readonly deprecation?: string;
}

/**
 * Loads `radius.json`, falling back to the formats it replaced.
 *
 * The fallback is what makes `init` → `dev` → `build` work in a project that
 * predates `radius.json`: without it, `build` would refuse every config the
 * old CLI ever wrote.
 */
export async function loadConfigFile(
  root: string,
  explicitPath?: string | null,
): Promise<LoadedConfig> {
  // A named file is read as given. Probing the directory instead is how
  // `--config agent.prod.json` ended up loading radius.json.
  if (explicitPath) {
    let raw: string;
    try {
      raw = await readFile(explicitPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new OperationalError(`No config at ${explicitPath}.`);
      }
      throw error;
    }
    if (explicitPath.endsWith(".json")) {
      return { config: parseConfig(raw), path: explicitPath };
    }
    const { readLegacyConfigFile } = await import("./legacy-config.js");
    const legacy = await readLegacyConfigFile(explicitPath);
    return {
      config: legacy,
      path: explicitPath,
      deprecation: `${explicitPath} is a deprecated config format and will stop being read.`,
    };
  }

  const raw = await readRawConfig(root);
  if (raw !== null) {
    return { config: parseConfig(raw), path: configPath(root) };
  }
  const { findLegacyConfig } = await import("./legacy-config.js");
  const legacy = await findLegacyConfig(root);
  if (legacy) {
    return {
      config: legacy.config,
      path: legacy.path,
      deprecation: `${legacy.filename} is deprecated and will stop being read. Run \`radius init\` to write ${CONFIG_FILENAME}.`,
    };
  }
  throw new OperationalError(
    `No ${CONFIG_FILENAME} in ${root}.`,
    "Run `radius init --harness <id>` to create one.",
  );
}

export async function loadConfig(root: string): Promise<AgentConfig> {
  return (await loadConfigFile(root)).config;
}

function parseConfig(raw: string): AgentConfig {
  const errors: ParseError[] = [];
  const parsed = parse(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new UsageError(`${CONFIG_FILENAME} is not valid JSON.`);
  }
  const result = AgentConfigSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new UsageError(`${CONFIG_FILENAME} is not a valid agent config:\n${detail}`);
  }
  return result.data;
}

/**
 * Idempotent fill-in: never overwrite a value that is already present, add
 * what is missing, and report exactly what changed. Edits go through
 * jsonc-parser so comments and formatting survive a re-run — the property
 * that made config-as-data worth choosing over executable config.
 */
export async function applyConfigEdits(
  root: string,
  edits: ReadonlyArray<{ path: (string | number)[]; value: unknown }>,
): Promise<string[]> {
  const existing = (await readRawConfig(root)) ?? "{}\n";
  let text = existing;
  const changed: string[] = [];
  for (const edit of edits) {
    const current = parse(text, [], { allowTrailingComma: true });
    if (valueAt(current, edit.path) !== undefined) continue;
    text = applyEdits(
      text,
      modify(text, edit.path, edit.value, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    );
    changed.push(edit.path.join("."));
  }
  if (text !== existing) await writeFile(configPath(root), text, "utf8");
  return changed;
}

function valueAt(source: unknown, path: (string | number)[]): unknown {
  let cursor: unknown = source;
  for (const segment of path) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string | number, unknown>)[segment];
  }
  return cursor;
}
