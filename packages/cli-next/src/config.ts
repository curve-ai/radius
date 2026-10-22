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

export async function loadConfig(root: string): Promise<AgentConfig> {
  const raw = await readRawConfig(root);
  if (raw === null) {
    throw new OperationalError(
      `No ${CONFIG_FILENAME} in ${root}.`,
      "Run `radius init --harness <id>` to create one.",
    );
  }
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
